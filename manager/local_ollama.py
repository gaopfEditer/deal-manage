"""
本地 Ollama `/api/generate` 代理：配置见项目根目录 `ollama_local.yaml`。

- POST /ollama/chat        JSON：`prompt` 或 `message`；可选 `promat`、`role`、`model`、`stream`；
                          `promat=tv_k_line` 时前置 `prompts/tv_k_line.txt` 内容；
                          可选附图：`images`（base64）、`image_path`、`image_paths`（有图则走 vision_model + payload.images）
- POST /ollama/chat-image  同上，但附图必填；支持 multipart 上传 file/files
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


def _sanitize_prompt_key(key: str, field: str) -> str:
    r = (key or "").strip()
    if not r:
        return ""
    if ".." in r or "/" in r or "\\" in r:
        raise HTTPException(status_code=400, detail=f"非法 {field}")
    if not all(ch in _ROLE_ALLOWED for ch in r):
        raise HTTPException(
            status_code=400,
            detail=f"{field} 仅允许字母、数字、下划线、点、连字符",
        )
    return r


def _load_prompt_file(key: str, field: str) -> str:
    """读取 prompts/{key}.txt；文件必须存在且路径限制在 prompts 目录内。"""
    safe = _sanitize_prompt_key(key, field)
    if not safe:
        return ""
    base = _prompts_dir().resolve()
    candidate = (base / f"{safe}.txt").resolve()
    try:
        candidate.relative_to(base)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"非法 {field} 路径") from exc
    if not candidate.is_file():
        raise HTTPException(
            status_code=404,
            detail=f"未找到提示词文件 prompts/{safe}.txt",
        )
    return candidate.read_text(encoding="utf-8", errors="replace").strip()


_PROMPT_SEP = "\n\n---\n\n"


def _merge_prompt_prefixes(
    *,
    promat: str | None,
    role: str | None,
    user_text: str,
) -> tuple[str, str | None, str | None]:
    """
    按顺序拼接：promat 模板 → role 模板 → 用户输入。
    返回 (最终 prompt, 使用的 promat 名或 None, 使用的 role 名或 None)。
    """
    segments: list[str] = []
    used_promat: str | None = None
    used_role: str | None = None

    if promat and str(promat).strip():
        name = str(promat).strip()
        prefix = _load_prompt_file(name, "promat")
        if prefix:
            segments.append(prefix)
        used_promat = name

    if role and str(role).strip():
        name = str(role).strip()
        prefix = _load_prompt_file(name, "role")
        if prefix:
            segments.append(prefix)
        used_role = name

    if user_text.strip():
        segments.append(user_text)

    if not segments:
        return user_text, used_promat, used_role
    if len(segments) == 1 and not user_text.strip():
        return segments[0], used_promat, used_role
    return _PROMPT_SEP.join(segments), used_promat, used_role


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
        "default_model": "gemma4:26b",
        "vision_model": "gemma4:26b",
        "stream": False,
        "timeout_seconds": 300,
        "allowed_image_path_roots": [
            "/Users/maotouying/Downloads",
            "/tmp",
            "/Users/maotouying/frontend/code/1.operations/auto-deal-eth/screenshots",
            "/Volumes/RamDisk/app_screenshots",
        ],
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
    promat: str = ""
    role: str = ""
    prompt: str = ""
    message: str = ""
    model: str | None = None
    stream: bool | None = None
    images: list[str] = Field(default_factory=list)
    image_path: str = ""
    image_paths: list[str] = Field(default_factory=list)


class OllamaImageJson(BaseModel):
    promat: str = ""
    role: str = ""
    prompt: str = ""
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


def _encode_image_file_b64(image_path: Path) -> str:
    """读取本地图片二进制并转为 Ollama /api/generate 所需的 base64 字符串。"""
    with image_path.open("rb") as image_file:
        return base64.standard_b64encode(image_file.read()).decode("utf-8")


def _read_local_image_b64_sync(path_str: str, roots: list[Path]) -> str:
    final = _path_must_be_allowed_file(Path(path_str), roots)
    return _encode_image_file_b64(final)


def prepare_ollama_generate_payload(
    settings: dict[str, Any],
    *,
    prompt: str,
    model_override: str | None = None,
    stream: bool | None = None,
    images_b64: list[str] | None = None,
) -> tuple[dict[str, Any], str, bool]:
    """
    组装 Ollama /api/generate 请求体。
    有附图时使用 vision_model，并在 payload 中附带 images 数组；无图则纯文本。
    """
    images: list[str] = []
    for raw in images_b64 or []:
        if isinstance(raw, str) and raw.strip():
            images.append(_strip_data_url_b64(raw))

    has_images = len(images) > 0
    model = (
        _resolve_vision_model(settings, model_override)
        if has_images
        else _resolve_text_model(settings, model_override)
    )
    stream_val = settings["stream"] if stream is None else bool(stream)

    payload: dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "stream": stream_val,
    }
    if has_images:
        payload["images"] = images
    return payload, model, has_images


async def _collect_images_b64(
    settings: dict[str, Any],
    *,
    images: list[str] | None = None,
    image_path: str | None = None,
    image_paths: list[str] | None = None,
) -> list[str]:
    out: list[str] = []
    for img in images or []:
        if isinstance(img, str) and img.strip():
            out.append(_strip_data_url_b64(img))
    path_list: list[str] = []
    for p in image_paths or []:
        if isinstance(p, str) and p.strip():
            path_list.append(p.strip())
    if image_path and str(image_path).strip():
        path_list.append(str(image_path).strip())
    if path_list:
        await _append_images_from_paths(path_list, settings, out)
    return out


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
    if not user_part and not (body.promat or "").strip() and not (body.role or "").strip():
        raise HTTPException(status_code=400, detail="缺少 prompt、message 或 promat/role 模板")

    prompt, used_promat, used_role = _merge_prompt_prefixes(
        promat=body.promat or None,
        role=body.role or None,
        user_text=user_part,
    )

    images_b64 = await _collect_images_b64(
        settings,
        images=body.images,
        image_path=body.image_path,
        image_paths=body.image_paths,
    )
    payload, model, has_images = prepare_ollama_generate_payload(
        settings,
        prompt=prompt,
        model_override=body.model,
        stream=body.stream,
        images_b64=images_b64,
    )
    stream = bool(payload["stream"])

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
            "vision": has_images,
        }
        if has_images:
            out["image_count"] = len(images_b64)
        if used_promat is not None:
            out["promat"] = used_promat
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
    if used_promat:
        headers["X-Ollama-Promat"] = used_promat
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
    promat_raw: str | None = None
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
        promat_raw = (data.promat or "").strip() or None
        role_raw = (data.role or "").strip() or None
        if not user_prompt and not promat_raw and not role_raw:
            raise HTTPException(status_code=400, detail="缺少 prompt 或 promat/role 模板")
        model_override = data.model
        stream_override = data.stream
        images_b64 = await _collect_images_b64(
            settings,
            images=data.images,
            image_path=data.image_path,
            image_paths=data.image_paths,
        )
        if not images_b64:
            raise HTTPException(
                status_code=400,
                detail="请提供图片：images（base64）、image_path / image_paths（本机路径）或 multipart 上传 file/files",
            )
    else:
        form = await request.form()
        user_prompt = str(form.get("prompt") or "").strip()
        pfv = form.get("promat")
        promat_raw = str(pfv).strip() if pfv else None
        rfv = form.get("role")
        role_raw = str(rfv).strip() if rfv else None
        if not user_prompt and not promat_raw and not role_raw:
            raise HTTPException(status_code=400, detail="缺少 prompt 或 promat/role 模板")
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

    prompt, used_promat, used_role = _merge_prompt_prefixes(
        promat=promat_raw,
        role=role_raw,
        user_text=user_prompt,
    )

    payload, model, has_images = prepare_ollama_generate_payload(
        settings,
        prompt=prompt,
        model_override=model_override,
        stream=stream_override,
        images_b64=images_b64,
    )
    stream = bool(payload["stream"])

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
            "vision": has_images,
            "image_count": len(images_b64),
        }
        if used_promat is not None:
            out_img["promat"] = used_promat
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
    if used_promat:
        headers_img["X-Ollama-Promat"] = used_promat
    if used_role:
        headers_img["X-Ollama-Role"] = used_role

    return StreamingResponse(
        ndjson_stream(),
        media_type="application/x-ndjson",
        headers=headers_img,
    )
