"""多平台文章发布：AI 润色（Ollama）+ 币安广场 OpenAPI；历史记录落盘。"""
from __future__ import annotations

import asyncio
import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import httpx
import yaml

from .local_ollama import load_ollama_settings
from .publish_prompts import build_publish_polish_prompt

ROOT_DIR = Path(__file__).resolve().parent.parent
HISTORY_PATH = ROOT_DIR / "manager" / "state" / "publish_history.json"

BINANCE_ADD_URL = (
    "https://www.binance.com/bapi/composite/v1/public/pgc/openApi/content/add"
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S")


def _mask_key(key: str) -> str:
    k = (key or "").strip()
    if len(k) <= 9:
        return "***" if k else ""
    return f"{k[:5]}...{k[-4:]}"


def load_publish_settings(cfg: dict[str, Any]) -> dict[str, Any]:
    pub = cfg.get("publish") if isinstance(cfg.get("publish"), dict) else {}
    ollama_model = str(pub.get("ollama_model") or os.getenv("PUBLISH_OLLAMA_MODEL") or "").strip()
    if not ollama_model:
        ollama_model = str(load_ollama_settings().get("default_model") or "gemma-uncensored")

    platforms_raw = pub.get("platforms")
    platforms: list[dict[str, Any]] = []
    if isinstance(platforms_raw, list):
        for p in platforms_raw:
            if not isinstance(p, dict):
                continue
            pid = str(p.get("id") or "").strip()
            if not pid:
                continue
            method = str(p.get("method") or "api").strip().lower()
            api_key = (
                os.getenv("BINANCE_SQUARE_API_KEY", "").strip()
                or str(p.get("api_key") or "").strip()
            )
            platforms.append(
                {
                    "id": pid,
                    "name": str(p.get("name") or pid),
                    "method": method,
                    "enabled": bool(p.get("enabled", method == "api")),
                    "api_url": str(p.get("api_url") or BINANCE_ADD_URL).strip(),
                    "api_key": api_key,
                    "api_key_masked": _mask_key(api_key),
                    "note": str(p.get("note") or "").strip(),
                }
            )

    if not platforms:
        key = os.getenv("BINANCE_SQUARE_API_KEY", "").strip()
        platforms = [
            {
                "id": "binance_square",
                "name": "币安广场",
                "method": "api",
                "enabled": bool(key),
                "api_url": BINANCE_ADD_URL,
                "api_key": key,
                "api_key_masked": _mask_key(key),
                "note": "",
            },
            {
                "id": "twitter",
                "name": "X / Twitter",
                "method": "cdp",
                "enabled": False,
                "api_url": "",
                "api_key": "",
                "api_key_masked": "",
                "note": "后续通过 CDP 浏览器自动化发布",
            },
        ]

    try:
        history_max = int(pub.get("history_max", 200))
    except (TypeError, ValueError):
        history_max = 200

    return {
        "ollama_model": ollama_model,
        "history_max": max(10, min(history_max, 2000)),
        "platforms": platforms,
    }


def _platform_by_id(settings: dict[str, Any], platform_id: str) -> dict[str, Any] | None:
    for p in settings.get("platforms") or []:
        if str(p.get("id")) == platform_id:
            return p
    return None


def list_platforms_public(settings: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for p in settings.get("platforms") or []:
        item = {
            "id": p["id"],
            "name": p["name"],
            "method": p["method"],
            "enabled": p["enabled"],
            "api_key_configured": bool(p.get("api_key")),
            "api_key_masked": p.get("api_key_masked") or "",
            "note": p.get("note") or "",
        }
        if p["method"] == "api":
            item["enabled"] = bool(p.get("api_key")) and item["enabled"]
        out.append(item)
    return out


def _load_history_sync() -> list[dict[str, Any]]:
    HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not HISTORY_PATH.is_file():
        return []
    try:
        data = json.loads(HISTORY_PATH.read_text(encoding="utf-8", errors="replace"))
        if isinstance(data, list):
            return data
    except Exception:
        pass
    return []


def _save_history_sync(items: list[dict[str, Any]], history_max: int) -> None:
    HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    trimmed = items[:history_max]
    HISTORY_PATH.write_text(
        json.dumps(trimmed, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def list_history(
    *,
    platform: str | None = None,
    limit: int = 50,
    offset: int = 0,
    history_max: int = 200,
) -> dict[str, Any]:
    items = _load_history_sync()
    if platform:
        items = [x for x in items if str(x.get("platform")) == platform]
    total = len(items)
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    page = items[offset : offset + limit]
    return {"items": page, "total": total, "limit": limit, "offset": offset}


def _append_history(entry: dict[str, Any], history_max: int) -> dict[str, Any]:
    items = _load_history_sync()
    items.insert(0, entry)
    _save_history_sync(items, history_max)
    return entry


def _extract_json_object(text: str) -> dict[str, Any]:
    t = (text or "").strip()
    if not t:
        raise ValueError("AI 返回为空")
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", t, re.IGNORECASE)
    if fence:
        t = fence.group(1).strip()
    start = t.find("{")
    end = t.rfind("}")
    if start < 0 or end <= start:
        raise ValueError(f"无法从 AI 响应中解析 JSON: {text[:300]!r}")
    blob = t[start : end + 1]
    data = json.loads(blob)
    if not isinstance(data, dict):
        raise ValueError("AI JSON 不是对象")
    return data


def _normalize_polish(data: dict[str, Any], fallback_content: str) -> dict[str, Any]:
    content = data.get("content")
    if content is None or not str(content).strip():
        content = fallback_content
    is_sign = data.get("isSign", data.get("is_sign", False))
    if isinstance(is_sign, str):
        is_sign = is_sign.strip().lower() in {"1", "true", "yes", "y", "on"}
    else:
        is_sign = bool(is_sign)
    try:
        star = int(data.get("star", 0))
    except (TypeError, ValueError):
        star = 0
    star = max(0, min(5, star))
    out: dict[str, Any] = {"isSign": is_sign, "content": str(content).strip(), "star": star}
    meta = data.get("meta")
    if isinstance(meta, dict):
        out["meta"] = meta
    return out


async def polish_content(
    *,
    raw_content: str,
    is_sign: bool | None = None,
    model: str | None = None,
    publish_settings: dict[str, Any] | None = None,
    compose_mode: str = "manual",
    style_id: str | None = None,
    strategy_id: str | None = None,
    style_ids: list[str] | None = None,
    strategy_ids: list[str] | None = None,
    source_kind: str = "generic",
) -> dict[str, Any]:
    raw = (raw_content or "").strip()
    if not raw:
        raise ValueError("正文不能为空")

    settings = load_ollama_settings()
    pub = publish_settings or {}
    use_model = (model or pub.get("ollama_model") or settings["default_model"]).strip()
    url = urljoin(
        settings["base_url"].rstrip("/") + "/",
        settings["generate_endpoint"].lstrip("/"),
    )
    prompt, prompt_selection = build_publish_polish_prompt(
        raw,
        is_sign=is_sign,
        compose_mode=compose_mode,
        style_id=style_id,
        strategy_id=strategy_id,
        style_ids=style_ids,
        strategy_ids=strategy_ids,
        source_kind=source_kind,
    )
    payload = {
        "model": use_model,
        "prompt": prompt,
        "stream": False,
    }
    timeout = httpx.Timeout(float(settings.get("timeout_seconds") or 300))

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, json=payload)
    if resp.status_code >= 400:
        raise RuntimeError(f"Ollama 请求失败 status={resp.status_code}: {resp.text[:500]!r}")

    body = resp.json()
    ai_text = str(body.get("response") or body.get("text") or "").strip()
    if not ai_text and isinstance(body.get("message"), dict):
        ai_text = str(body["message"].get("content") or "").strip()

    parsed = _extract_json_object(ai_text)
    polished = _normalize_polish(parsed, raw)
    return {
        "polished": polished,
        "model": use_model,
        "raw_ai": ai_text,
        "prompt_selection": prompt_selection,
    }


async def publish_binance_square(*, content: str, api_key: str, api_url: str) -> dict[str, Any]:
    text = (content or "").strip()
    if not text:
        raise ValueError("发布正文不能为空")
    if not api_key:
        raise ValueError("未配置币安广场 API Key（BINANCE_SQUARE_API_KEY 或 config publish）")

    headers = {
        "X-Square-OpenAPI-Key": api_key,
        "Content-Type": "application/json",
        "clienttype": "binanceSkill",
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
        resp = await client.post(api_url, headers=headers, json={"bodyTextOnly": text})
    try:
        data = resp.json()
    except Exception:
        data = {"raw": resp.text[:1000]}

    code = str(data.get("code") or "")
    if resp.status_code >= 400 or code not in ("000000", "0"):
        msg = data.get("message") or data.get("msg") or resp.text[:300]
        raise RuntimeError(f"币安广场发布失败 code={code!r} message={msg!r}")

    post_id = ""
    inner = data.get("data")
    if isinstance(inner, dict):
        post_id = str(inner.get("id") or "").strip()
    post_url = f"https://www.binance.com/square/post/{post_id}" if post_id else ""
    return {"post_id": post_id, "post_url": post_url, "api_response": data}


async def publish_article(
    *,
    settings: dict[str, Any],
    platform_id: str,
    original_content: str,
    final_content: str | None = None,
    is_sign: bool | None = None,
    use_ai: bool = True,
    polished_override: dict[str, Any] | None = None,
    source: str | None = None,
) -> dict[str, Any]:
    platform = _platform_by_id(settings, platform_id)
    if not platform:
        raise ValueError(f"未知平台: {platform_id}")

    raw = (original_content or "").strip()
    if not raw and not (final_content or "").strip():
        raise ValueError("正文不能为空")

    polished: dict[str, Any] | None = polished_override
    if use_ai and polished is None:
        ai = await polish_content(
            raw_content=raw or (final_content or ""),
            is_sign=is_sign,
            publish_settings=settings,
            compose_mode="manual",
        )
        polished = ai["polished"]

    publish_text = (final_content or "").strip()
    if not publish_text and polished:
        publish_text = str(polished.get("content") or "").strip()
    if not publish_text:
        publish_text = raw

    entry_id = str(uuid.uuid4())
    record: dict[str, Any] = {
        "id": entry_id,
        "platform": platform_id,
        "platform_name": platform.get("name"),
        "status": "pending",
        "original_content": raw,
        "polished": polished,
        "published_content": publish_text,
        "post_id": "",
        "post_url": "",
        "error": None,
        "created_at": _now_iso(),
        "source": source or "api",
    }

    method = str(platform.get("method") or "api")
    try:
        if method == "cdp":
            raise RuntimeError("该平台尚未实现 CDP 发布，请稍后再试")
        if platform_id == "binance_square" or method == "api":
            result = await publish_binance_square(
                content=publish_text,
                api_key=str(platform.get("api_key") or ""),
                api_url=str(platform.get("api_url") or BINANCE_ADD_URL),
            )
            record["status"] = "published"
            record["post_id"] = result.get("post_id") or ""
            record["post_url"] = result.get("post_url") or ""
            record["api_response"] = result.get("api_response")
        else:
            raise ValueError(f"不支持的发布方式: {method}")
    except Exception as exc:  # noqa: BLE001
        record["status"] = "failed"
        record["error"] = f"{type(exc).__name__}: {exc}"

    saved = await asyncio.to_thread(
        _append_history, record, int(settings.get("history_max", 200))
    )
    if saved.get("status") == "failed":
        raise RuntimeError(str(saved.get("error") or "发布失败"))
    return saved


async def compose_and_publish_group_signal(
    *,
    settings: dict[str, Any],
    signal: str,
    style_ids: list[str],
    strategy_id: str | None = None,
    strategy_ids: list[str] | None = None,
    compose_mode: str = "auto",
    platform_id: str = "binance_square",
    is_sign: bool | None = None,
    model: str | None = None,
    publish: bool = True,
) -> dict[str, Any]:
    """
    群内交易信号 → Prompt 模块润色 →（可选）币安广场发布。
    style_ids 至少一项；多风格或未定策略时走 auto 路由。
    """
    raw = (signal or "").strip()
    if not raw:
        raise ValueError("signal 不能为空")
    if not style_ids:
        raise ValueError("style_ids 不能为空，请传入 publish_manifest 中的 style id 列表")

    st_list = list(strategy_ids or [])
    if strategy_id:
        st_list = [strategy_id, *st_list]

    ai = await polish_content(
        raw_content=raw,
        is_sign=is_sign,
        model=model,
        publish_settings=settings,
        compose_mode=compose_mode,
        style_ids=style_ids,
        strategy_ids=st_list or None,
        source_kind="signal",
    )
    polished = ai["polished"]
    final_text = str(polished.get("content") or "").strip()
    if not final_text:
        raise RuntimeError("AI 润色结果正文为空")

    out: dict[str, Any] = {
        "polished": polished,
        "model": ai.get("model"),
        "prompt_selection": ai.get("prompt_selection"),
        "published": False,
        "publish_item": None,
    }

    if not publish:
        return out

    item = await publish_article(
        settings=settings,
        platform_id=platform_id,
        original_content=raw,
        final_content=final_text,
        is_sign=is_sign,
        use_ai=False,
        polished_override=polished,
        source="group_signal",
    )
    out["published"] = True
    out["publish_item"] = item
    return out
