"""发布润色 Prompt 模块库：风格 / 策略 / 自动路由。"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

ROOT_DIR = Path(__file__).resolve().parent.parent
PROMPTS_DIR = ROOT_DIR / "prompts"
MANIFEST_PATH = PROMPTS_DIR / "publish_manifest.yaml"
BASE_OUTPUT_PATH = PROMPTS_DIR / "square_publish_polish.txt"

_ALLOWED_ID = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")


def _sanitize_module_id(raw: str) -> str:
    s = (raw or "").strip()
    if not s or not all(ch in _ALLOWED_ID for ch in s):
        raise ValueError(f"非法 prompt id: {raw!r}")
    return s


def _read_prompt_file(rel_path: str) -> str:
    rel = rel_path.strip().replace("\\", "/")
    if ".." in rel or rel.startswith("/"):
        raise ValueError(f"非法 prompt 路径: {rel_path!r}")
    full = (PROMPTS_DIR / rel).resolve()
    if not str(full).startswith(str(PROMPTS_DIR.resolve())):
        raise ValueError(f"非法 prompt 路径: {rel_path!r}")
    if not full.is_file():
        raise FileNotFoundError(f"Prompt 文件不存在: {rel_path}")
    return full.read_text(encoding="utf-8", errors="replace").strip()


def _load_manifest() -> dict[str, Any]:
    if not MANIFEST_PATH.is_file():
        return {"styles": [], "strategies": [], "router": None}
    data = yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8", errors="replace")) or {}
    if not isinstance(data, dict):
        return {"styles": [], "strategies": [], "router": None}
    return data


def _catalog_items(entries: Any) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    if not isinstance(entries, list):
        return out
    for item in entries:
        if not isinstance(item, dict):
            continue
        pid = str(item.get("id") or "").strip()
        if not pid:
            continue
        out.append(
            {
                "id": pid,
                "name": str(item.get("name") or pid),
                "description": str(item.get("description") or ""),
                "file": str(item.get("file") or ""),
            }
        )
    return out


def list_publish_prompt_catalog() -> dict[str, Any]:
    manifest = _load_manifest()
    router_raw = manifest.get("router")
    router: dict[str, str] | None = None
    if isinstance(router_raw, dict) and router_raw.get("id"):
        router = {
            "id": str(router_raw.get("id")),
            "name": str(router_raw.get("name") or router_raw.get("id")),
            "description": str(router_raw.get("description") or ""),
            "file": str(router_raw.get("file") or ""),
        }
    return {
        "styles": _catalog_items(manifest.get("styles")),
        "strategies": _catalog_items(manifest.get("strategies")),
        "router": router,
    }


def _load_module_body(module_id: str, kind: str) -> str:
    """kind: styles | strategies | router"""
    manifest = _load_manifest()
    if kind == "router":
        router = manifest.get("router")
        if not isinstance(router, dict):
            raise FileNotFoundError("未配置自动路由 prompt")
        rid = _sanitize_module_id(str(router.get("id") or ""))
        if module_id and module_id != rid:
            pass
        rel = str(router.get("file") or "")
        return _read_prompt_file(rel)

    entries = manifest.get(kind) or []
    if not isinstance(entries, list):
        raise FileNotFoundError(f"未找到 {kind} 模块: {module_id}")
    mid = _sanitize_module_id(module_id)
    for item in entries:
        if not isinstance(item, dict):
            continue
        if str(item.get("id")) == mid:
            rel = str(item.get("file") or "")
            return _read_prompt_file(rel)
    raise FileNotFoundError(f"未找到 {kind} 模块: {module_id}")


def _base_output_spec(*, include_meta: bool) -> str:
    base = ""
    if BASE_OUTPUT_PATH.is_file():
        base = BASE_OUTPUT_PATH.read_text(encoding="utf-8", errors="replace").strip()
    meta_line = ""
    if include_meta:
        meta_line = (
            '\n- meta: 对象，必须包含 "style" 与 "strategy" 字符串标签'
            "（与你选用的模块 id 一致）"
        )
    json_tail = (
        "\n\n---\n\n【输出格式】\n"
        "只输出一个 JSON 对象，不要 markdown 代码块，不要其它说明文字。\n"
        "字段：\n"
        "- isSign: 布尔，是否在文末署名\n"
        "- content: 字符串，润色后的正文\n"
        "- star: 整数 0-5，内容质量自评"
        f"{meta_line}\n"
        '格式示例：{"isSign":false,"content":"...","star":3'
        + (',"meta":{"style":"style_tianya_classic","strategy":"strategy_left_ambush"}}' if include_meta else "}")
    )
    if base:
        return base + json_tail
    return "你是币安广场发文助手。" + json_tail


SIGNAL_PREAMBLE_PATH = PROMPTS_DIR / "publish" / "signal_group_trade.txt"


def validate_module_ids(
    *,
    style_ids: list[str] | None = None,
    strategy_ids: list[str] | None = None,
) -> tuple[list[str], list[str]]:
    catalog = list_publish_prompt_catalog()
    valid_styles = {s["id"] for s in catalog.get("styles") or []}
    valid_strategies = {s["id"] for s in catalog.get("strategies") or []}
    styles: list[str] = []
    for raw in style_ids or []:
        sid = _sanitize_module_id(str(raw))
        if sid not in valid_styles:
            raise ValueError(f"未知 style_id: {sid}")
        if sid not in styles:
            styles.append(sid)
    strategies: list[str] = []
    for raw in strategy_ids or []:
        stid = _sanitize_module_id(str(raw))
        if stid not in valid_strategies:
            raise ValueError(f"未知 strategy_id: {stid}")
        if stid not in strategies:
            strategies.append(stid)
    return styles, strategies


def _load_signal_preamble() -> str:
    manifest = _load_manifest()
    sig = manifest.get("signal")
    if isinstance(sig, dict) and sig.get("file"):
        return _read_prompt_file(str(sig["file"]))
    if SIGNAL_PREAMBLE_PATH.is_file():
        return SIGNAL_PREAMBLE_PATH.read_text(encoding="utf-8", errors="replace").strip()
    return ""


def _candidate_pool_block(kind: str, allowed: list[str]) -> str:
    catalog = list_publish_prompt_catalog()
    items = catalog.get("styles" if kind == "styles" else "strategies") or []
    label = "叙事风格" if kind == "styles" else "交易策略内核"
    lines = [
        f"【{label}候选池】你必须且只能从下列 module id 中选一个（写入 meta.{ 'style' if kind == 'styles' else 'strategy' }）："
    ]
    for item in items:
        if item["id"] in allowed:
            lines.append(f"- `{item['id']}`：{item['description']}")
    return "\n".join(lines)


def build_publish_polish_prompt(
    raw_content: str,
    *,
    is_sign: bool | None = None,
    compose_mode: str = "manual",
    style_id: str | None = None,
    strategy_id: str | None = None,
    style_ids: list[str] | None = None,
    strategy_ids: list[str] | None = None,
    source_kind: str = "generic",
) -> tuple[str, dict[str, str | None]]:
    """
    组装完整润色 prompt。
    compose_mode: manual | auto
    返回 (prompt, selection_meta)
    """
    mode = (compose_mode or "manual").strip().lower()
    if mode not in ("manual", "auto"):
        raise ValueError("compose_mode 仅支持 manual 或 auto")

    allowed_styles, allowed_strategies = validate_module_ids(
        style_ids=style_ids,
        strategy_ids=strategy_ids,
    )
    if style_id:
        sid = _sanitize_module_id(style_id)
        if sid not in allowed_styles:
            allowed_styles.append(sid)
    if strategy_id:
        stid = _sanitize_module_id(strategy_id)
        if stid not in allowed_strategies:
            allowed_strategies.append(stid)

    selection: dict[str, str | None] = {
        "compose_mode": mode,
        "style": None,
        "strategy": None,
        "style_ids": ",".join(allowed_styles) if allowed_styles else None,
        "strategy_ids": ",".join(allowed_strategies) if allowed_strategies else None,
        "source_kind": (source_kind or "generic").strip().lower(),
    }
    parts: list[str] = []

    if (source_kind or "").strip().lower() == "signal":
        preamble = _load_signal_preamble()
        if preamble:
            parts.append(preamble)

    use_auto = mode == "auto" or (
        len(allowed_styles) > 1 or (len(allowed_styles) >= 1 and not allowed_strategies)
    )
    single_style = len(allowed_styles) == 1
    single_strategy = len(allowed_strategies) == 1

    if use_auto:
        parts.append(_load_module_body("", "router"))
        if allowed_styles:
            parts.append(_candidate_pool_block("styles", allowed_styles))
        if allowed_strategies:
            parts.append(_candidate_pool_block("strategies", allowed_strategies))
        selection["compose_mode"] = "auto"
    else:
        if single_style:
            sid = allowed_styles[0]
            parts.append(_load_module_body(sid, "styles"))
            selection["style"] = sid
        if single_strategy:
            stid = allowed_strategies[0]
            parts.append(_load_module_body(stid, "strategies"))
            selection["strategy"] = stid
        elif strategy_id:
            stid = _sanitize_module_id(strategy_id)
            parts.append(_load_module_body(stid, "strategies"))
            selection["strategy"] = stid
        if selection["style"] and selection["strategy"]:
            parts.append(
                "【融合指令】\n"
                "请用上述「叙事外壳」包装「策略内核」，融合为一篇币安广场短文；"
                "完整保留信号中的价位、挂单层级、止损/止盈与标签，不编造数据。"
            )
        elif not selection["style"] and not selection["strategy"]:
            parts.append(
                "你是币安广场发文助手。根据用户原文润色，使表达清晰、专业，适合交易社区发布。"
            )

    include_meta = use_auto or bool(allowed_styles)
    parts.append(_base_output_spec(include_meta=include_meta))

    sign_hint = ""
    if is_sign is not None:
        sign_hint = f"\n用户期望 isSign={str(is_sign).lower()}。"
    user_block = f"\n\n---\n\n【用户原文】\n{raw_content.strip()}{sign_hint}"
    return "\n\n".join(parts) + user_block, selection
