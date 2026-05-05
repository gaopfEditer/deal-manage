"""
本地 Ollama `/api/generate` 代理：配置见项目根目录 `ollama_local.yaml`。

- POST /ollama/chat        JSON：`prompt` 或 `message`，可选 `role`（对应 `prompts/{role}.txt`
                          全文与用户内容拼接）、`model`、`stream`
- POST /ollama/chat-image  JSON：`prompt`；图片三选一或组合：`images`（base64）、`image_path`（单路径）、
                          `image_paths`（路径列表，服务端读盘再编码）；可选 `role`、`model`。
                          multipart：`file`/`files` 上传；可选 `image_path`、`image_paths`（每行一个路径可重复字段）、`role`
"""
from __future__ import annotations

import asyncio
import base64
import os
from pathlib import Path
from typing import Any, AsyncIterator
from urllib.parse import urljoin

import httpx
import yaml
from fastapi import APIRouter, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

ROOT_DIR = Path(__file__).resolve().parent.parent
PROMPTS_DIR = ROOT_DIR / "prompts"

_ROLE_ALLOWED = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-")


def _prompts_dir() -> Path:
    return PROMPTS_DIR


def _sanitize_role(role: str) -> str:
    r = (role or "").strip()
    if not r:
        return ""
    if ".." in r or "/" in r or "\\" in r:
        raise HTTPException(status_code=400, detail="非法 role")
    if not all(ch in _ROLE_ALLOWED for ch in r):
        raise HTTPException(status_code=400, detail="role 仅允许字母、数字、下划线、点、连字符")
    return r


def _load_role_prompt(role: str) -> str:
    """读取 prompts/{role}.txt；文件必须存在且路径限制在 prompts 目录内。"""
    safe = _sanitize_role(role)
    if not safe:
        return ""
    base = _prompts_dir().resolve()
    candidate = (base / f"{safe}.txt").resolve()
    try:
        candidate.relative_to(base)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="非法 role 路径") from exc
    if not candidate.is_file():
        raise HTTPException(
            status_code=404,
            detail=f"未找到角色提示词文件 prompts/{safe}.txt",
        )
    return candidate.read_text(encoding="utf-8", errors="replace").strip()


def _merge_role_prefix(role: str | None, user_text: str) -> tuple[str, str | None]:
    """
    若有 role：全文 = 角色文件内容 + 分隔 + 用户输入。
    返回 (最终 prompt, 使用的 role 名或 None)。
    """
    if not role or not str(role).strip():
        return user_text, None
    prefix = _load_role_prompt(str(role).strip())
    if not prefix:
        return user_text, str(role).strip()
    merged = f"{prefix}\n\n---\n\n{user_text}"
    return merged, str(role).strip()


def _config_path() -> Path:
    raw = (os.getenv("OLLAMA_LOCAL_CONFIG") or "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return ROOT_DIR / "ollama_local.yaml"


def load_ollama_settings() -> dict[str, Any]:
    path = _config_path()
    defaults: dict[str, Any] = {
        "base_url": "http://localhost:11434",
        "generate_endpoint": "/api/generate",
        "default_model": "gemma-uncensored",
        "vision_model": "",
        "stream": False,
        "timeout_seconds": 300,
        "allowed_image_path_roots": [],
    }
    if not path.exists():
        return defaults
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
        data = yaml.safe_load(text) or {}
    except Exception:
        return defaults
    if not isinstance(data, dict):
        return defaults
    merged = {**defaults, **data}
    merged["base_url"] = str(merged.get("base_url") or defaults["base_url"]).rstrip("/")
    ep = str(merged.get("generate_endpoint") or defaults["generate_endpoint"]).strip()
    if not ep.startswith("/"):
        ep = "/" + ep
    merged["generate_endpoint"] = ep
    merged["default_model"] = str(merged.get("default_model") or defaults["default_model"]).strip()
    vm = merged.get("vision_model")
    merged["vision_model"] = str(vm).strip() if vm else ""
    merged["stream"] = bool(merged.get("stream", False))
    try:
        merged["timeout_seconds"] = float(merged.get("timeout_seconds", 300))
    except (TypeError, ValueError):
        merged["timeout_seconds"] = 300.0
    air = merged.get("allowed_image_path_roots")
    if isinstance(air, list):
        merged["allowed_image_path_roots"] = air
    else:
        merged["allowed_image_path_roots"] = []
    return merged


def _generate_url(settings: dict[str, Any]) -> str:
    base = settings["base_url"].rstrip("/") + "/"
    return urljoin(base, settings["generate_endpoint"].lstrip("/"))


def _strip_data_url_b64(s: str) -> str:
    t = s.strip()
    if t.startswith("data:") and "base64," in t:
        return t.split("base64,", 1)[1].strip()
    return t


class OllamaChatJson(BaseModel):
    role: str = ""
    prompt: str = ""
    message: str = ""
    model: str | None = None
    stream: bool | None = None


class OllamaImageJson(BaseModel):
    role: str = ""
    prompt: str
    images: list[str] = Field(default_factory=list)
    image_path: str = ""
    image_paths: list[str] = Field(default_factory=list)
    model: str | None = None
    stream: bool | None = None


router = APIRouter(tags=["local-ollama"])


def _timeout(settings: dict[str, Any]) -> httpx.Timeout:
    sec = float(settings.get("timeout_seconds") or 300.0)
    return httpx.Timeout(sec)


def _resolve_text_model(settings: dict[str, Any], override: str | None) -> str:
    if override and str(override).strip():
        return str(override).strip()
    return settings["default_model"]


def _resolve_vision_model(settings: dict[str, Any], override: str | None) -> str:
    if override and str(override).strip():
        return str(override).strip()
    vm = settings.get("vision_model") or ""
    if isinstance(vm, str) and vm.strip():
        return vm.strip()
    return settings["default_model"]


def _allowed_image_roots(settings: dict[str, Any]) -> list[Path]:
    """本地图片路径允许的根目录；未配置非空列表时仅允许本仓库根目录。"""
    raw = settings.get("allowed_image_path_roots")
    roots: list[Path] = []
    if isinstance(raw, list):
        for item in raw:
            t = str(item or "").strip()
            if t:
                roots.append(Path(t).expanduser().resolve())
    if not roots:
        roots = [ROOT_DIR.resolve()]
    seen: set[str] = set()
    out: list[Path] = []
    for p in roots:
        key = str(p)
        if key not in seen:
            seen.add(key)
            out.append(p)
    return out


def _path_must_be_allowed_file(path: Path, roots: list[Path]) -> Path:
    resolved = path.expanduser().resolve()
    if not resolved.is_file():
        raise HTTPException(status_code=404, detail=f"图片文件不存在或不是文件: {resolved}")
    for root in roots:
        try:
            resolved.relative_to(root)
            return resolved
        except ValueError:
            continue
    roots_hint = ", ".join(str(r) for r in roots)
    raise HTTPException(
        status_code=403,
        detail=f"路径不在允许目录内: {resolved}。允许根: [{roots_hint}]。可在 ollama_local.yaml 配置 allowed_image_path_roots。",
    )


def _read_local_image_b64_sync(path_str: str, roots: list[Path]) -> str:
    final = _path_must_be_allowed_file(Path(path_str), roots)
    raw_b = final.read_bytes()
    return base64.standard_b64encode(raw_b).decode("ascii")


async def _append_images_from_paths(path_strings: list[str], settings: dict[str, Any], out: list[str]) -> None:
    roots = _allowed_image_roots(settings)
    for s in path_strings:
        t = (s or "").strip()
        if not t:
            continue
        b64 = await asyncio.to_thread(_read_local_image_b64_sync, t, roots)
        out.append(b64)


def _user_prompt(body: OllamaChatJson) -> str:
    p = (body.prompt or "").strip()
    m = (body.message or "").strip()
    if p and m:
        return f"{p}\n{m}"
    return p or m


@router.post("/ollama/chat", response_model=None)
async def ollama_chat(request: Request):
    settings = load_ollama_settings()
    url = _generate_url(settings)

    try:
        raw = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"invalid json: {exc}") from exc

    body = OllamaChatJson.model_validate(raw)
    user_part = _user_prompt(body)
    if not user_part:
        raise HTTPException(status_code=400, detail="缺少 prompt 或 message")

    prompt, used_role = _merge_role_prefix(body.role or None, user_part)

    model = _resolve_text_model(settings, body.model)
    stream = settings["stream"] if body.stream is None else bool(body.stream)

    payload: dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "stream": stream,
    }

    if not stream:
        try:
            async with httpx.AsyncClient(timeout=_timeout(settings)) as client:
                r = await client.post(url, json=payload)
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"Ollama 请求失败: {exc}") from exc
        try:
            data = r.json()
        except Exception:
            raise HTTPException(status_code=502, detail=r.text[:2000]) from None
        if r.status_code >= 400:
            raise HTTPException(
                status_code=min(r.status_code, 599),
                detail=data if isinstance(data, dict) else {"error": str(data)},
            )
        out: dict[str, Any] = {
            "ok": True,
            "model": model,
            "response": data.get("response", ""),
            "raw": data,
        }
        if used_role is not None:
            out["role"] = used_role
        return JSONResponse(content=out)

    async def ndjson_stream() -> AsyncIterator[bytes]:
        async with httpx.AsyncClient(timeout=None) as client:
            try:
                async with client.stream("POST", url, json=payload) as response:
                    if response.status_code >= 400:
                        body = await response.aread()
                        yield body
                        return
                    async for chunk in response.aiter_bytes():
                        yield chunk
            except httpx.RequestError as exc:
                err = str(exc).encode("utf-8")
                yield err

    headers = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    if used_role:
        headers["X-Ollama-Role"] = used_role

    return StreamingResponse(
        ndjson_stream(),
        media_type="application/x-ndjson",
        headers=headers,
    )


@router.post("/ollama/chat-image", response_model=None)
async def ollama_chat_image(request: Request):
    settings = load_ollama_settings()
    url = _generate_url(settings)

    ct = (request.headers.get("content-type") or "").lower()
    user_prompt: str
    role_raw: str | None = None
    model_override: str | None = None
    stream_override: bool | None = None
    images_b64: list[str] = []

    if "application/json" in ct:
        try:
            raw = await request.json()
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"invalid json: {exc}") from exc
        data = OllamaImageJson.model_validate(raw)
        user_prompt = (data.prompt or "").strip()
        if not user_prompt:
            raise HTTPException(status_code=400, detail="缺少 prompt")
        role_raw = (data.role or "").strip() or None
        model_override = data.model
        stream_override = data.stream
        for img in data.images:
            if isinstance(img, str) and img.strip():
                images_b64.append(_strip_data_url_b64(img))
        path_list: list[str] = []
        for p in data.image_paths or []:
            if isinstance(p, str) and p.strip():
                path_list.append(p.strip())
        if (data.image_path or "").strip():
            path_list.append(str(data.image_path).strip())
        if path_list:
            await _append_images_from_paths(path_list, settings, images_b64)
        if not images_b64:
            raise HTTPException(
                status_code=400,
                detail="请提供图片：images（base64）、image_path / image_paths（本机路径）或 multipart 上传 file/files",
            )
    else:
        form = await request.form()
        user_prompt = str(form.get("prompt") or "").strip()
        if not user_prompt:
            raise HTTPException(status_code=400, detail="缺少 prompt")
        rfv = form.get("role")
        role_raw = str(rfv).strip() if rfv else None
        m = form.get("model")
        model_override = str(m).strip() if m else None
        sv = form.get("stream")
        if sv is not None:
            stream_override = str(sv).strip().lower() in {"1", "true", "yes", "on"}
        upload_list: list[UploadFile] = []
        for key in ("files", "file"):
            for item in form.getlist(key):
                if hasattr(item, "read"):
                    upload_list.append(item)  # type: ignore[arg-type]
        for uf in upload_list:
            raw_b = await uf.read()
            images_b64.append(base64.standard_b64encode(raw_b).decode("ascii"))
        form_paths: list[str] = []
        ip = form.get("image_path")
        if ip is not None and str(ip).strip():
            form_paths.append(str(ip).strip())
        for item in form.getlist("image_paths"):
            if item is not None and str(item).strip():
                form_paths.append(str(item).strip())
        if form_paths:
            await _append_images_from_paths(form_paths, settings, images_b64)
        if not images_b64:
            raise HTTPException(
                status_code=400,
                detail="请上传 file/files，或提供 image_path / image_paths（本机绝对/相对路径）",
            )

    prompt, used_role = _merge_role_prefix(role_raw, user_prompt)

    model = _resolve_vision_model(settings, model_override)
    stream = settings["stream"] if stream_override is None else bool(stream_override)

    payload: dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "images": images_b64,
        "stream": stream,
    }

    if not stream:
        try:
            async with httpx.AsyncClient(timeout=_timeout(settings)) as client:
                r = await client.post(url, json=payload)
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"Ollama 请求失败: {exc}") from exc
        try:
            data = r.json()
        except Exception:
            raise HTTPException(status_code=502, detail=r.text[:2000]) from None
        if r.status_code >= 400:
            raise HTTPException(
                status_code=min(r.status_code, 599),
                detail=data if isinstance(data, dict) else {"error": str(data)},
            )
        out_img: dict[str, Any] = {
            "ok": True,
            "model": model,
            "response": data.get("response", ""),
            "raw": data,
        }
        if used_role is not None:
            out_img["role"] = used_role
        return JSONResponse(content=out_img)

    async def ndjson_stream() -> AsyncIterator[bytes]:
        async with httpx.AsyncClient(timeout=None) as client:
            try:
                async with client.stream("POST", url, json=payload) as response:
                    if response.status_code >= 400:
                        body = await response.aread()
                        yield body
                        return
                    async for chunk in response.aiter_bytes():
                        yield chunk
            except httpx.RequestError as exc:
                yield str(exc).encode("utf-8")

    headers_img = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    if used_role:
        headers_img["X-Ollama-Role"] = used_role

    return StreamingResponse(
        ndjson_stream(),
        media_type="application/x-ndjson",
        headers=headers_img,
    )
