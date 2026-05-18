"""Telegram Bot：统一 token + 群组别名解析 + sendMessage。"""
from __future__ import annotations

import os
from typing import Any

import httpx


def _mask_token(token: str) -> str:
    k = (token or "").strip()
    if len(k) <= 9:
        return "***" if k else ""
    return f"{k[:5]}...{k[-4:]}"


def load_telegram_settings(cfg: dict[str, Any]) -> dict[str, Any]:
    tg = cfg.get("telegram") if isinstance(cfg.get("telegram"), dict) else {}
    token = (
        os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
        or str(tg.get("bot_token") or "").strip()
    )
    chats: dict[str, str] = {}
    items: list[dict[str, Any]] = []
    for c in tg.get("chats") or []:
        if not isinstance(c, dict):
            continue
        alias = str(c.get("id") or "").strip()
        raw_cid = c.get("chat_id")
        if alias and raw_cid is not None:
            cid = str(raw_cid).strip()
            chats[alias] = cid
            items.append(
                {
                    "id": alias,
                    "name": str(c.get("name") or alias),
                    "chat_id": cid,
                }
            )
    return {
        "bot_token": token,
        "bot_token_masked": _mask_token(token),
        "chats": chats,
        "chat_items": items,
    }


def resolve_chat_id(chat_ref: str | int, settings: dict[str, Any]) -> str:
    """chat_ref 可为配置别名（如 binance_square）或数值群组 id。"""
    if chat_ref is None:
        return ""
    key = str(chat_ref).strip()
    if not key:
        return ""
    alias_map = settings.get("chats") or {}
    if key in alias_map:
        return str(alias_map[key])
    return key


def resolve_script_telegram_target(
    script_cfg: dict[str, Any], settings: dict[str, Any]
) -> tuple[str, str]:
    """
    解析脚本级 Telegram 目标。
    返回 (bot_token, chat_id)；token 优先全局，脚本内 telegram_token 仅作兼容覆盖。
    """
    token = str(settings.get("bot_token") or "").strip()
    legacy_token = str(script_cfg.get("telegram_token") or "").strip()
    if legacy_token:
        token = legacy_token

    chat_ref = script_cfg.get("telegram_chat")
    if chat_ref is None or str(chat_ref).strip() == "":
        chat_ref = script_cfg.get("telegram_chat_id")
    chat_id = resolve_chat_id(chat_ref, settings) if chat_ref is not None else ""
    return token, chat_id


async def send_telegram_message(
    *,
    bot_token: str,
    chat_id: str,
    text: str,
    parse_mode: str | None = None,
    disable_web_page_preview: bool | None = None,
) -> dict[str, Any]:
    token = (bot_token or "").strip()
    cid = (chat_id or "").strip()
    body = (text or "").strip()
    if not token:
        raise ValueError("未配置 Telegram Bot Token（telegram.bot_token 或 TELEGRAM_BOT_TOKEN）")
    if not cid:
        raise ValueError("缺少 chat_id（群组 id 或配置别名）")
    if not body:
        raise ValueError("消息正文不能为空")

    api = f"https://api.telegram.org/bot{token}/sendMessage"
    payload: dict[str, Any] = {"chat_id": cid, "text": body}
    if parse_mode:
        payload["parse_mode"] = parse_mode
    if disable_web_page_preview is not None:
        payload["disable_web_page_preview"] = disable_web_page_preview

    async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as client:
        resp = await client.post(api, json=payload)
    try:
        data = resp.json()
    except Exception:
        data = {"raw": resp.text[:1000]}

    if resp.status_code >= 400 or not data.get("ok", True):
        desc = data.get("description") or data.get("raw") or resp.text[:300]
        raise RuntimeError(f"Telegram sendMessage 失败: {desc!r}")

    return {"chat_id": cid, "result": data.get("result"), "ok": True}
