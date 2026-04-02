"""
本地实现 Gemini / 通义千问接口（直接调官方 API，不经过第三方网关）。

- POST /gemini/chat   支持 application/json 或 multipart/form-data
- POST /gemini/image  JSON：文生图（Gemini 多模态 IMAGE 输出）
- POST /qwen/chat     JSON：DashScope OpenAI 兼容，支持 stream

环境变量见项目根目录 `.env.example`。
"""
from __future__ import annotations

import base64
import json
import mimetypes
import os
from typing import Any, AsyncIterator

import httpx
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

GEMINI_REST = "https://generativelanguage.googleapis.com/v1beta"


def _gemini_key() -> str:
    return (os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or "").strip()


def _gemini_chat_model() -> str:
    return os.getenv("GEMINI_CHAT_MODEL", "gemini-2.0-flash").strip()


def _gemini_image_models() -> list[str]:
    raw = os.getenv("GEMINI_IMAGE_MODELS", "gemini-2.0-flash-exp,gemini-2.0-flash")
    return [m.strip() for m in raw.split(",") if m.strip()]


def _qwen_key() -> str:
    return os.getenv("QWEN_API_KEY", "").strip()


def _qwen_base() -> str:
    return os.getenv("QWEN_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1").rstrip("/")


def _qwen_default_model() -> str:
    return os.getenv("QWEN_DEFAULT_MODEL", "qwen-plus").strip()


ROLE_INSTRUCTIONS: dict[str, str] = {
    "common": "你是一个简洁、专业的助手。",
    "k_line_analysis": (
        "你是证券与加密货币 K 线分析助手。请结合用户文字与附图（若有），"
        "从趋势、关键位、量能与风险角度给出分析；若涉及投资建议，可简要提示风险。"
    ),
    "analysis_img": "请根据用户上传的图片回答用户问题，说明图片主旨与关键细节。",
}


def _instruction_for_role(role: str) -> str:
    return ROLE_INSTRUCTIONS.get(role, ROLE_INSTRUCTIONS["common"])


class GeminiChatJson(BaseModel):
    role: str = "common"
    message: str = ""


class RefImage(BaseModel):
    data: str
    mime_type: str = "image/png"


class GeminiImageJson(BaseModel):
    prompt: str
    aspectRatio: str | None = None
    referenceImages: list[RefImage] = Field(default_factory=list)


class QwenChatJson(BaseModel):
    messages: list[dict[str, Any]]
    model: str | None = None
    stream: bool = False


def _guess_mime(name: str | None) -> str:
    if not name:
        return "image/png"
    mt, _ = mimetypes.guess_type(name)
    return mt or "application/octet-stream"


def _parse_gemini_generate_content(body: dict[str, Any]) -> dict[str, Any]:
    text_parts: list[str] = []
    images: list[dict[str, str]] = []
    candidates = body.get("candidates") or []
    if not candidates:
        return {"ok": True, "text": "", "images": [], "raw": body}
    content = (candidates[0] or {}).get("content") or {}
    parts = content.get("parts") or []
    for p in parts:
        if not isinstance(p, dict):
            continue
        if "text" in p:
            text_parts.append(str(p["text"]))
        inline = p.get("inlineData") or p.get("inline_data")
        if isinstance(inline, dict) and inline.get("data"):
            images.append(
                {
                    "mimeType": inline.get("mimeType") or inline.get("mime_type") or "image/png",
                    "data": str(inline["data"]),
                }
            )
    return {
        "ok": True,
        "text": "".join(text_parts).strip(),
        "images": images,
        "raw": body,
    }


async def _gemini_generate(model: str, payload: dict[str, Any], api_key: str) -> httpx.Response:
    url = f"{GEMINI_REST}/models/{model}:generateContent"
    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as client:
        return await client.post(url, params={"key": api_key}, json=payload)


router = APIRouter(tags=["upstream-bz"])


@router.post("/gemini/chat", response_model=None)
async def gemini_chat(request: Request):
    key = _gemini_key()
    if not key:
        raise HTTPException(status_code=500, detail="缺少 GEMINI_API_KEY 或 GOOGLE_API_KEY")

    ct = (request.headers.get("content-type") or "").lower()
    user_parts: list[dict[str, Any]] = []
    role = "common"

    if "application/json" in ct:
        try:
            raw = await request.json()
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail=f"invalid json: {exc}") from exc
        parsed = GeminiChatJson.model_validate(raw)
        role = parsed.role
        user_parts.append({"text": parsed.message})
    else:
        form = await request.form()
        role = str(form.get("role") or "common")
        message = str(form.get("message") or "")
        upload_list: list[UploadFile] = []
        for key in ("files", "file"):
            for item in form.getlist(key):
                if hasattr(item, "read"):
                    upload_list.append(item)  # type: ignore[arg-type]
        if upload_list:
            user_parts.append({"text": message})
            for uf in upload_list:
                raw_b = await uf.read()
                b64 = base64.standard_b64encode(raw_b).decode("ascii")
                mime = getattr(uf, "content_type", None) or _guess_mime(getattr(uf, "filename", None))
                user_parts.append({"inlineData": {"mimeType": mime, "data": b64}})
        else:
            user_parts.append({"text": message})

    system_text = _instruction_for_role(role)
    payload = {
        "systemInstruction": {"parts": [{"text": system_text}]},
        "contents": [{"role": "user", "parts": user_parts}],
    }
    model = _gemini_chat_model()

    try:
        resp = await _gemini_generate(model, payload, key)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Gemini 请求失败: {exc}") from exc

    try:
        body = resp.json()
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail=resp.text[:2000]) from None

    if resp.status_code >= 400:
        raise HTTPException(
            status_code=min(resp.status_code, 599),
            detail=body if isinstance(body, dict) else {"error": str(body)},
        )

    out = _parse_gemini_generate_content(body)
    out["role"] = role
    return JSONResponse(content=out)


@router.post("/gemini/image", response_model=None)
async def gemini_image(request: Request):
    key = _gemini_key()
    if not key:
        raise HTTPException(status_code=500, detail="缺少 GEMINI_API_KEY 或 GOOGLE_API_KEY")

    try:
        raw = await request.json()
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"invalid json: {exc}") from exc

    data = GeminiImageJson.model_validate(raw)
    prompt = data.prompt
    if data.aspectRatio and str(data.aspectRatio).strip() not in ("", "1:1"):
        prompt = f"Aspect ratio {data.aspectRatio}. {prompt}"

    parts: list[dict[str, Any]] = [{"text": prompt}]
    for img in data.referenceImages:
        parts.append(
            {
                "inlineData": {
                    "mimeType": img.mime_type or "image/png",
                    "data": img.data,
                }
            }
        )

    payload = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "responseMimeType": "text/plain",
        },
    }

    last_err: Any = None
    for model in _gemini_image_models():
        try:
            resp = await _gemini_generate(model, payload, key)
        except httpx.RequestError as exc:
            last_err = exc
            continue
        try:
            body = resp.json()
        except json.JSONDecodeError:
            last_err = resp.text[:500]
            continue
        if resp.status_code in (403, 404):
            last_err = body
            continue
        if resp.status_code >= 400:
            last_err = body
            continue
        parsed = _parse_gemini_generate_content(body)
        if parsed.get("images"):
            parsed["model"] = model
            return JSONResponse(content=parsed)
        last_err = "no image in response"

    raise HTTPException(
        status_code=502,
        detail={"error": "图片生成失败或无可用模型", "last": str(last_err)},
    )


@router.post("/qwen/chat", response_model=None)
async def qwen_chat(request: Request):
    key = _qwen_key()
    if not key:
        raise HTTPException(status_code=500, detail="缺少 QWEN_API_KEY")

    try:
        raw = await request.json()
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"invalid json: {exc}") from exc

    body = QwenChatJson.model_validate(raw)
    model = body.model or _qwen_default_model()
    url = f"{_qwen_base()}/chat/completions"
    upstream = {
        "model": model,
        "messages": body.messages,
        "stream": body.stream,
    }

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    if not body.stream:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as client:
                r = await client.post(url, json=upstream, headers=headers)
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"Qwen 请求失败: {exc}") from exc
        try:
            data = r.json()
        except json.JSONDecodeError:
            return JSONResponse(content={"error": r.text[:2000]}, status_code=r.status_code)
        return JSONResponse(content=data, status_code=r.status_code)

    async def stream_bytes() -> AsyncIterator[bytes]:
        async with httpx.AsyncClient(timeout=None) as client:
            try:
                async with client.stream("POST", url, json=upstream, headers=headers) as response:
                    async for chunk in response.aiter_bytes():
                        yield chunk
            except httpx.RequestError as exc:
                err = json.dumps({"error": str(exc)}, ensure_ascii=False).encode("utf-8")
                yield err

    return StreamingResponse(
        stream_bytes(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
