"""文章发布 API：润色预览、发布、历史记录。"""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .publish_attachments import resolve_media_file

from .publish_prompts import list_publish_prompt_catalog
from .publish_prompts import validate_module_ids
from .publish_service import (
    compose_and_publish_group_signal,
    list_history,
    list_platforms_public,
    load_publish_settings,
    polish_content,
    publish_article,
)

router = APIRouter(prefix="/api/publish", tags=["publish"])


class PolishPayload(BaseModel):
    content: str = Field(..., min_length=1)
    is_sign: bool | None = None
    model: str | None = None
    compose_mode: str = "manual"
    style_id: str | None = None
    strategy_id: str | None = None
    style_ids: list[str] | None = None
    strategy_ids: list[str] | None = None
    source_kind: str = "generic"


class SignalComposePublishPayload(BaseModel):
    """群内交易信号：按 style_ids（+ 可选 strategy）润色后发布到币安广场等。"""

    signal: str = Field(..., min_length=1, description="原始群内交易信号全文")
    style_ids: list[str] = Field(
        ...,
        min_length=1,
        description="叙事风格 module id 列表，见 GET /api/publish/prompts → styles",
    )
    strategy_id: str | None = Field(
        None,
        description="固定策略内核 id；与 strategy_ids 二选一或并存（会合并）",
    )
    strategy_ids: list[str] | None = Field(
        None,
        description="策略候选池；多个时与 style 多选一样走 AI 自动择一",
    )
    compose_mode: str = Field(
        "auto",
        description="manual：仅当 style/strategy 各唯一时完全手动模块；auto：AI 路由组合",
    )
    platform: str = "binance_square"
    publish: bool = Field(True, description="false 时只润色不发布")
    is_sign: bool | None = None
    model: str | None = None


class PublishPayload(BaseModel):
    platform: str = "binance_square"
    content: str = Field(..., min_length=1)
    final_content: str | None = None
    is_sign: bool | None = None
    use_ai: bool = True
    polished: dict[str, Any] | None = None
    images: list[str] | None = Field(
        None,
        description="附图 base64 列表（可带 data:image/...;base64, 前缀），最多 9 张",
    )
    image_tokens: list[str] | None = Field(
        None,
        description="币安广场 imageToken（若已上传）；与 images 可同时传",
    )


def _settings() -> dict[str, Any]:
    from .main import load_config

    return load_publish_settings(load_config())


@router.get("/prompts")
async def get_publish_prompts():
    return await asyncio.to_thread(list_publish_prompt_catalog)


@router.get("/platforms")
async def get_platforms():
    settings = _settings()
    return {"items": list_platforms_public(settings)}


@router.get("/media/{publish_id}/{file_id}")
async def get_publish_media(publish_id: str, file_id: str):
    try:
        path = await asyncio.to_thread(resolve_media_file, publish_id, file_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    media = "image/jpeg"
    suffix = path.suffix.lower()
    if suffix == ".png":
        media = "image/png"
    elif suffix == ".webp":
        media = "image/webp"
    elif suffix == ".gif":
        media = "image/gif"
    return FileResponse(path, media_type=media)


@router.get("/history")
async def get_history(platform: str | None = None, limit: int = 50, offset: int = 0):
    settings = _settings()
    return await asyncio.to_thread(
        list_history,
        platform=platform,
        limit=limit,
        offset=offset,
        history_max=int(settings.get("history_max", 200)),
    )


@router.post("/polish")
async def post_polish(payload: PolishPayload):
    settings = _settings()
    try:
        result = await polish_content(
            raw_content=payload.content,
            is_sign=payload.is_sign,
            model=payload.model or settings.get("ollama_model"),
            publish_settings=settings,
            compose_mode=payload.compose_mode,
            style_id=payload.style_id,
            strategy_id=payload.strategy_id,
            style_ids=payload.style_ids,
            strategy_ids=payload.strategy_ids,
            source_kind=payload.source_kind,
        )
        return {"ok": True, **result}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/signal")
async def post_signal_compose_publish(payload: SignalComposePublishPayload):
    """
    群内交易信号一站式：加载 signal 前置说明 + 指定 style_ids（及策略模块）→ Ollama 润色 → 发布。

    典型调用方：外部 bot / 群消息转发服务，POST 原文与 `style_tianya_classic` 等 id 即可。
    """
    settings = _settings()
    try:
        validate_module_ids(
            style_ids=payload.style_ids,
            strategy_ids=payload.strategy_ids,
        )
        if payload.strategy_id:
            validate_module_ids(strategy_ids=[payload.strategy_id])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    plat = next(
        (p for p in settings.get("platforms") or [] if str(p.get("id")) == payload.platform),
        None,
    )
    if payload.publish:
        if not plat:
            raise HTTPException(status_code=404, detail=f"平台不存在: {payload.platform}")
        if str(plat.get("method")) == "cdp":
            raise HTTPException(status_code=501, detail="该平台将使用 CDP 发布，尚未实现")
        if not plat.get("api_key") and str(plat.get("method")) == "api":
            raise HTTPException(status_code=400, detail="未配置 API Key")

    try:
        result = await compose_and_publish_group_signal(
            settings=settings,
            signal=payload.signal,
            style_ids=payload.style_ids,
            strategy_id=payload.strategy_id,
            strategy_ids=payload.strategy_ids,
            compose_mode=payload.compose_mode,
            platform_id=payload.platform,
            is_sign=payload.is_sign,
            model=payload.model or settings.get("ollama_model"),
            publish=payload.publish,
        )
        return {"ok": True, **result}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/publish")
async def post_publish(payload: PublishPayload):
    settings = _settings()
    plat = next(
        (p for p in settings.get("platforms") or [] if str(p.get("id")) == payload.platform),
        None,
    )
    if not plat:
        raise HTTPException(status_code=404, detail=f"平台不存在: {payload.platform}")
    if str(plat.get("method")) == "cdp":
        raise HTTPException(status_code=501, detail="该平台将使用 CDP 发布，尚未实现")
    if not plat.get("api_key") and str(plat.get("method")) == "api":
        raise HTTPException(status_code=400, detail="未配置 API Key")

    try:
        item = await publish_article(
            settings=settings,
            platform_id=payload.platform,
            original_content=payload.content,
            final_content=payload.final_content,
            is_sign=payload.is_sign,
            use_ai=payload.use_ai,
            polished_override=payload.polished,
            images=payload.images,
            image_tokens=payload.image_tokens,
        )
        out: dict[str, Any] = {"ok": True, "item": item}
        if item.get("warnings"):
            out["warnings"] = item["warnings"]
        return out
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc
