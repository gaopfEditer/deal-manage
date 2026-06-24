"""
本地 Ollama 任务规划：要素对齐 → 定向追问 → 生成执行细则。

调用链：httpx POST {base_url}/api/chat（默认 http://localhost:11434，模型 gemma4:26b，
见 ollama_local.yaml 的 task_planner_model / default_model）。

会话持久化到 manager/state/task_planner.json，不依赖长对话历史，
每次仅用【当前要素表】+【用户最新回答】做增量对齐。
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import httpx

from .local_ollama import load_ollama_settings

ROOT_DIR = Path(__file__).resolve().parent.parent
STATE_PATH = ROOT_DIR / "manager" / "state" / "task_planner.json"

# 要素字段（与 UPDATE_PROMPT 一致）
SCHEMA_KEYS = (
    "goal",
    "tech_stack",
    "data_protocol",
    "core_logic",
    "performance_deadline",
    "deliverables",
    "acceptance_criteria",
)
REQUIRED_KEYS = ("goal", "tech_stack", "core_logic")

UPDATE_PROMPT = """你是一个高精度的任务要素提取器。
对比【已有要素】与用户【最新回答】，增量更新要素表。
- 用户提到新细节：写入对应字段
- 已有值且用户未否定：保持原样
- 未知填 null（JSON null）
- 信息已足够支撑写任务书时，将 alignment_status 设为 "sufficient"
- 否则 alignment_status 为 "incomplete"，并在 missing_priority 填最应优先追问的字段名（须为下列 key 之一）

字段说明：
- goal: 任务目标与背景
- tech_stack: 技术栈 / 运行环境
- data_protocol: 数据格式、API、存储协议
- core_logic: 核心业务逻辑与流程
- performance_deadline: 性能、边界、截止时间
- deliverables: 交付物清单
- acceptance_criteria: 验收标准

必须严格输出 JSON，不要 markdown 代码块：
{
  "goal": null,
  "tech_stack": null,
  "data_protocol": null,
  "core_logic": null,
  "performance_deadline": null,
  "deliverables": null,
  "acceptance_criteria": null,
  "alignment_status": "incomplete",
  "missing_priority": "tech_stack"
}"""

FIELD_LABELS: dict[str, str] = {
    "goal": "任务目标",
    "tech_stack": "技术栈",
    "data_protocol": "数据/协议",
    "core_logic": "核心逻辑",
    "performance_deadline": "性能与截止",
    "deliverables": "交付物",
    "acceptance_criteria": "验收标准",
}


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _planner_settings() -> dict[str, Any]:
    """读取 ollama_local.yaml：base_url 默认 http://localhost:11434，模型默认 gemma4:26b。"""
    base = load_ollama_settings()
    model = str(
        base.get("task_planner_model") or base.get("default_model") or "gemma4:26b"
    ).strip()
    try:
        max_turns = int(base.get("task_planner_max_turns", 5))
    except (TypeError, ValueError):
        max_turns = 5
    return {
        **base,
        "task_planner_model": model,
        "task_planner_max_turns": max(2, min(max_turns, 12)),
    }


def _chat_url(settings: dict[str, Any]) -> str:
    return urljoin(settings["base_url"].rstrip("/") + "/", "api/chat")


def _empty_schema() -> dict[str, Any]:
    return {k: None for k in SCHEMA_KEYS}


def _load_store() -> dict[str, Any]:
    if not STATE_PATH.is_file():
        return {"sessions": {}}
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("sessions"), dict):
            return data
    except Exception:
        pass
    return {"sessions": {}}


def _save_store(store: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(
        json.dumps(store, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _parse_json_content(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    if not text:
        raise ValueError("empty model response")
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("response is not a JSON object")
    return data


def _is_filled(value: Any) -> bool:
    if value is None:
        return False
    s = str(value).strip().lower()
    return s not in ("", "null", "none", "未知", "待定", "无", "n/a")


def _empty_fields(schema: dict[str, Any]) -> list[str]:
    return [k for k in SCHEMA_KEYS if not _is_filled(schema.get(k))]


def _merge_schema(old: dict[str, Any], new: dict[str, Any]) -> dict[str, Any]:
    merged = _empty_schema()
    for k in SCHEMA_KEYS:
        nv = new.get(k)
        ov = old.get(k)
        if _is_filled(nv):
            merged[k] = str(nv).strip()
        elif _is_filled(ov):
            merged[k] = str(ov).strip()
        else:
            merged[k] = None
    status = str(new.get("alignment_status") or old.get("alignment_status") or "incomplete").strip()
    merged["alignment_status"] = "sufficient" if status == "sufficient" else "incomplete"
    mp = new.get("missing_priority") or old.get("missing_priority")
    if mp in SCHEMA_KEYS:
        merged["missing_priority"] = mp
    elif _empty_fields(merged):
        merged["missing_priority"] = _empty_fields(merged)[0]
    else:
        merged["missing_priority"] = None
    return merged


def _should_complete(schema: dict[str, Any], turn_count: int, max_turns: int, force: bool) -> bool:
    if force:
        return True
    if turn_count >= max_turns:
        return True
    if schema.get("alignment_status") == "sufficient":
        return True
    required_empty = [k for k in REQUIRED_KEYS if not _is_filled(schema.get(k))]
    if not required_empty and not _empty_fields(schema):
        return True
    # 必填齐且已追问至少 2 轮也可结束（避免死磕可选项）
    if not required_empty and turn_count >= 2:
        optional_empty = [k for k in SCHEMA_KEYS if k not in REQUIRED_KEYS and not _is_filled(schema.get(k))]
        if len(optional_empty) <= 2:
            return True
    return False


def _next_target(schema: dict[str, Any]) -> str:
    mp = schema.get("missing_priority")
    if mp in SCHEMA_KEYS and not _is_filled(schema.get(mp)):
        return str(mp)
    for k in REQUIRED_KEYS:
        if not _is_filled(schema.get(k)):
            return k
    empty = _empty_fields(schema)
    return empty[0] if empty else "goal"


async def _ollama_chat(
    *,
    messages: list[dict[str, str]],
    model: str,
    settings: dict[str, Any],
    json_mode: bool = False,
) -> str:
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": False,
    }
    if json_mode:
        payload["format"] = "json"
    timeout = httpx.Timeout(float(settings.get("timeout_seconds") or 300))
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(_chat_url(settings), json=payload)
    if resp.status_code >= 400:
        raise RuntimeError(f"Ollama chat failed {resp.status_code}: {resp.text[:500]}")
    data = resp.json()
    msg = data.get("message") or {}
    content = msg.get("content") if isinstance(msg, dict) else None
    if not content:
        raise RuntimeError("Ollama returned empty message")
    return str(content)


async def _update_schema(
    current: dict[str, Any], user_input: str, settings: dict[str, Any], model: str
) -> dict[str, Any]:
    schema_snapshot = {k: current.get(k) for k in SCHEMA_KEYS}
    messages = [
        {"role": "system", "content": UPDATE_PROMPT},
        {
            "role": "user",
            "content": (
                f"【当前已有要素】\n{json.dumps(schema_snapshot, ensure_ascii=False)}\n\n"
                f"【用户最新回答】\n{user_input}"
            ),
        },
    ]
    raw = await _ollama_chat(messages=messages, model=model, settings=settings, json_mode=True)
    try:
        parsed = _parse_json_content(raw)
    except Exception:
        # 非 JSON 时做一次纠错重试
        retry = [
            {"role": "system", "content": "只输出合法 JSON 对象，不要其它文字。"},
            {"role": "user", "content": raw},
        ]
        raw2 = await _ollama_chat(messages=retry, model=model, settings=settings, json_mode=True)
        parsed = _parse_json_content(raw2)
    return _merge_schema(current, parsed)


async def _ask_question(target_key: str, schema: dict[str, Any], settings: dict[str, Any], model: str) -> str:
    label = FIELD_LABELS.get(target_key, target_key)
    filled = {k: schema.get(k) for k in SCHEMA_KEYS if _is_filled(schema.get(k))}
    messages = [
        {
            "role": "system",
            "content": (
                "你是资深产品经理。根据已有要素，针对【缺失项】向用户提一个简短、明确的追问。"
                "一句话直切主题，不要寒暄，不要一次问多个问题。"
            ),
        },
        {
            "role": "user",
            "content": (
                f"缺失项: {label} ({target_key})\n"
                f"已有要素: {json.dumps(filled, ensure_ascii=False)}"
            ),
        },
    ]
    return (await _ollama_chat(messages=messages, model=model, settings=settings)).strip()


async def _generate_final_spec(schema: dict[str, Any], settings: dict[str, Any], model: str) -> str:
    payload = {k: schema.get(k) for k in SCHEMA_KEYS}
    prompt = (
        "请根据以下已对齐的任务要素，生成一份可直接交给工程师的 Markdown 任务书，包含：\n"
        "1. 背景与目标\n2. 技术方案与架构要点\n3. 核心接口/模块设计\n4. 实施步骤（可勾选清单）\n"
        "5. 验收标准\n6. 风险与避坑指南\n\n"
        f"要素 JSON：\n{json.dumps(payload, ensure_ascii=False, indent=2)}"
    )
    messages = [{"role": "user", "content": prompt}]
    return (await _ollama_chat(messages=messages, model=model, settings=settings)).strip()


def _session_public(session: dict[str, Any]) -> dict[str, Any]:
    schema = session.get("current_schema") or _empty_schema()
    return {
        "id": session["id"],
        "title": session.get("title") or "未命名任务",
        "status": session.get("status", "IN_PROGRESS"),
        "turn_count": session.get("turn_count", 0),
        "max_turns": session.get("max_turns", 5),
        "created_at": session.get("created_at"),
        "updated_at": session.get("updated_at"),
        "current_schema": {k: schema.get(k) for k in SCHEMA_KEYS},
        "alignment_status": schema.get("alignment_status", "incomplete"),
        "missing_priority": schema.get("missing_priority"),
        "empty_fields": _empty_fields(schema),
        "field_labels": FIELD_LABELS,
        "messages": session.get("messages") or [],
        "final_spec": session.get("final_spec"),
    }


def list_sessions() -> list[dict[str, Any]]:
    store = _load_store()
    items = []
    for sid, s in (store.get("sessions") or {}).items():
        if not isinstance(s, dict):
            continue
        items.append(
            {
                "id": sid,
                "title": s.get("title") or "未命名任务",
                "status": s.get("status", "IN_PROGRESS"),
                "updated_at": s.get("updated_at"),
                "turn_count": s.get("turn_count", 0),
            }
        )
    items.sort(key=lambda x: str(x.get("updated_at") or ""), reverse=True)
    return items


def get_session(session_id: str) -> dict[str, Any]:
    store = _load_store()
    session = (store.get("sessions") or {}).get(session_id)
    if not session:
        raise KeyError(session_id)
    return _session_public(session)


def create_session(initial_input: str) -> dict[str, Any]:
    text = (initial_input or "").strip()
    if not text:
        raise ValueError("initial_input 不能为空")
    settings = _planner_settings()
    sid = str(uuid.uuid4())
    session: dict[str, Any] = {
        "id": sid,
        "title": text[:48] + ("…" if len(text) > 48 else ""),
        "status": "IN_PROGRESS",
        "turn_count": 0,
        "max_turns": settings["task_planner_max_turns"],
        "created_at": _now(),
        "updated_at": _now(),
        "current_schema": _empty_schema(),
        "messages": [],
        "final_spec": None,
    }
    store = _load_store()
    store.setdefault("sessions", {})[sid] = session
    _save_store(store)
    return session


async def chat_session(session_id: str, user_input: str, *, force_complete: bool = False) -> dict[str, Any]:
    text = (user_input or "").strip()
    if not text and not force_complete:
        raise ValueError("user_input 不能为空")

    store = _load_store()
    session = (store.get("sessions") or {}).get(session_id)
    if not session:
        raise KeyError(session_id)
    if session.get("status") == "COMPLETED" and not force_complete:
        return _session_public(session)

    settings = _planner_settings()
    model = settings["task_planner_model"]
    max_turns = int(session.get("max_turns") or settings["task_planner_max_turns"])

    if text:
        session.setdefault("messages", []).append({"role": "user", "content": text, "time": _now()})
        session["turn_count"] = int(session.get("turn_count") or 0) + 1

    current = session.get("current_schema") or _empty_schema()
    if text:
        session["current_schema"] = await _update_schema(current, text, settings, model)
    schema = session["current_schema"]

    turn = int(session.get("turn_count") or 0)
    if _should_complete(schema, turn, max_turns, force_complete):
        final = await _generate_final_spec(schema, settings, model)
        session["status"] = "COMPLETED"
        session["final_spec"] = final
        session["updated_at"] = _now()
        session.setdefault("messages", []).append(
            {"role": "assistant", "content": "已生成任务执行细则，见右侧「任务书」。", "time": _now()}
        )
        store["sessions"][session_id] = session
        _save_store(store)
        out = _session_public(session)
        out["next_question"] = None
        return out

    target = _next_target(schema)
    question = await _ask_question(target, schema, settings, model)
    session.setdefault("messages", []).append(
        {"role": "assistant", "content": question, "time": _now()}
    )
    session["updated_at"] = _now()
    store["sessions"][session_id] = session
    _save_store(store)
    out = _session_public(session)
    out["next_question"] = question
    return out


async def start_and_chat(initial_input: str) -> dict[str, Any]:
    session = create_session(initial_input)
    return await chat_session(session["id"], initial_input, force_complete=False)
