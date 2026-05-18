"""Telegram 对外 API：按 chat_id / 别名转发消息到指定群组。"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .telegram_service import (
    load_telegram_settings,
    resolve_chat_id,
    send_telegram_message,
)

router = APIRouter(prefix="/api/telegram", tags=["telegram"])


class TelegramSendPayload(BaseModel):
    """chat_id：数值群组 id，或 config telegram.chats[].id 别名。"""

    chat_id: str | int = Field(..., description="群组 chat_id 或配置中的别名 id")
    text: str = Field(..., min_length=1, description="要发送的纯文本消息")
    parse_mode: str | None = Field(None, description="可选：HTML / Markdown / MarkdownV2")
    disable_web_page_preview: bool | None = None


def _settings() -> dict[str, Any]:
    from .main import load_config

    return load_telegram_settings(load_config())


@router.get("/config")
async def get_telegram_config():
    s = _settings()
    return {
        "bot_token_configured": bool(s.get("bot_token")),
        "bot_token_masked": s.get("bot_token_masked") or "",
        "chats": s.get("chat_items") or [],
    }


@router.post("/send")
async def post_telegram_send(payload: TelegramSendPayload):
    settings = _settings()
    token = str(settings.get("bot_token") or "").strip()
    if not token:
        raise HTTPException(
            status_code=400,
            detail="未配置 Bot Token，请在 config.yaml 的 telegram.bot_token 或环境变量 TELEGRAM_BOT_TOKEN 中设置",
        )
    try:
        resolved = resolve_chat_id(payload.chat_id, settings)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not resolved:
        raise HTTPException(status_code=400, detail="无效的 chat_id")

    try:
        result = await send_telegram_message(
            bot_token=token,
            chat_id=resolved,
            text=payload.text,
            parse_mode=payload.parse_mode,
            disable_web_page_preview=payload.disable_web_page_preview,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {
        "ok": True,
        "chat_id": resolved,
        "alias": str(payload.chat_id).strip()
        if str(payload.chat_id).strip() in (settings.get("chats") or {})
        else None,
        **result,
    }
