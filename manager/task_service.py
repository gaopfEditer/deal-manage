"""
手动任务：用户自行粘贴内容，设定提醒时间；支持日历范围查询。
持久化：manager/state/tasks.json
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent.parent
STATE_PATH = ROOT_DIR / "manager" / "state" / "tasks.json"

_FMT = "%Y-%m-%d %H:%M:%S"
_DATE_FMT = "%Y-%m-%d"


def _now() -> str:
    return datetime.now().strftime(_FMT)


def _parse_dt(raw: str | None) -> datetime | None:
    if not raw or not str(raw).strip():
        return None
    s = str(raw).strip().replace("T", " ")
    for fmt, n in ((_FMT, 19), (_DATE_FMT, 10)):
        try:
            return datetime.strptime(s[:n], fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def _load_store() -> dict[str, Any]:
    if not STATE_PATH.is_file():
        return {"tasks": []}
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("tasks"), list):
            return data
    except Exception:
        pass
    return {"tasks": []}


def _save_store(store: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(
        json.dumps(store, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _title_from_content(title: str | None, content: str) -> str:
    t = (title or "").strip()
    if t:
        return t[:120]
    first = (content or "").strip().splitlines()[0] if content else ""
    first = first.strip()[:120]
    return first or "未命名任务"


def _public_task(t: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": t["id"],
        "title": t.get("title") or "",
        "content": t.get("content") or "",
        "due_at": t.get("due_at"),
        "remind_at": t.get("remind_at"),
        "status": t.get("status") or "pending",
        "reminded": bool(t.get("reminded")),
        "reminded_at": t.get("reminded_at"),
        "created_at": t.get("created_at"),
        "updated_at": t.get("updated_at"),
    }


def list_tasks(
    *,
    date_from: str | None = None,
    date_to: str | None = None,
    status: str | None = None,
) -> list[dict[str, Any]]:
    store = _load_store()
    tasks = [t for t in store.get("tasks") or [] if isinstance(t, dict)]
    df = _parse_dt(date_from) if date_from else None
    dt = _parse_dt(date_to) if date_to else None

    out: list[dict[str, Any]] = []
    for t in tasks:
        if status and t.get("status") != status:
            continue
        due = _parse_dt(t.get("due_at"))
        if df or dt:
            if due is None:
                continue
            due_d = due.date()
            if df and due_d < df.date():
                continue
            if dt and due_d > dt.date():
                continue
        out.append(_public_task(t))

    out.sort(key=lambda x: str(x.get("due_at") or x.get("created_at") or ""))
    return out


def get_task(task_id: str) -> dict[str, Any]:
    store = _load_store()
    for t in store.get("tasks") or []:
        if isinstance(t, dict) and t.get("id") == task_id:
            return _public_task(t)
    raise KeyError(task_id)


def _normalize_dt_str(raw: str) -> str:
    s = str(raw).strip().replace("T", " ")
    if len(s) == 10:
        return f"{s} 09:00:00"
    if len(s) == 16:
        return f"{s}:00"
    return s


def create_task(
    *,
    content: str,
    title: str | None = None,
    due_at: str,
    remind_at: str | None = None,
) -> dict[str, Any]:
    content = (content or "").strip()
    if not content:
        raise ValueError("任务内容不能为空")
    due = _parse_dt(_normalize_dt_str(due_at))
    if not due:
        raise ValueError("due_at 格式无效，请使用 YYYY-MM-DD HH:MM:SS 或 YYYY-MM-DD")

    remind = _parse_dt(_normalize_dt_str(remind_at)) if remind_at else due
    if not remind:
        remind = due

    now = _now()
    task = {
        "id": str(uuid.uuid4()),
        "title": _title_from_content(title, content),
        "content": content,
        "due_at": due.strftime(_FMT),
        "remind_at": remind.strftime(_FMT),
        "status": "pending",
        "reminded": False,
        "reminded_at": None,
        "created_at": now,
        "updated_at": now,
    }
    store = _load_store()
    store.setdefault("tasks", []).append(task)
    _save_store(store)
    return _public_task(task)


def update_task(task_id: str, **fields: Any) -> dict[str, Any]:
    store = _load_store()
    tasks = store.get("tasks") or []
    for t in tasks:
        if not isinstance(t, dict) or t.get("id") != task_id:
            continue
        if "content" in fields and fields["content"] is not None:
            t["content"] = str(fields["content"]).strip()
        if "title" in fields and fields["title"] is not None:
            t["title"] = str(fields["title"]).strip()[:120]
        elif "content" in fields:
            t["title"] = _title_from_content(t.get("title"), t["content"])
        if "due_at" in fields and fields["due_at"]:
            due = _parse_dt(_normalize_dt_str(str(fields["due_at"])))
            if not due:
                raise ValueError("due_at 格式无效")
            t["due_at"] = due.strftime(_FMT)
        if "remind_at" in fields:
            if fields["remind_at"]:
                remind = _parse_dt(_normalize_dt_str(str(fields["remind_at"])))
                if not remind:
                    raise ValueError("remind_at 格式无效")
                t["remind_at"] = remind.strftime(_FMT)
            else:
                t["remind_at"] = t.get("due_at")
        if "status" in fields and fields["status"] in ("pending", "done"):
            t["status"] = fields["status"]
        if fields.get("reset_reminder"):
            t["reminded"] = False
            t["reminded_at"] = None
        t["updated_at"] = _now()
        _save_store(store)
        return _public_task(t)
    raise KeyError(task_id)


def delete_task(task_id: str) -> None:
    store = _load_store()
    before = len(store.get("tasks") or [])
    store["tasks"] = [t for t in (store.get("tasks") or []) if t.get("id") != task_id]
    if len(store["tasks"]) == before:
        raise KeyError(task_id)
    _save_store(store)


def complete_task(task_id: str, done: bool = True) -> dict[str, Any]:
    return update_task(task_id, status="done" if done else "pending")


def range_for_view(anchor: str, view: str) -> tuple[str, str]:
    """根据锚定日期与视图返回 [from, to] 日期字符串（仅日期部分）。"""
    raw = (anchor or "").strip()
    if len(raw) >= 10:
        raw = raw[:10]
    d = _parse_dt(raw) or datetime.now()
    if view == "day":
        s = d.strftime(_DATE_FMT)
        return s, s
    if view == "week":
        start = d - timedelta(days=d.weekday())
        end = start + timedelta(days=6)
        return start.strftime(_DATE_FMT), end.strftime(_DATE_FMT)
    if view == "month":
        start = d.replace(day=1)
        if d.month == 12:
            end = d.replace(year=d.year + 1, month=1, day=1) - timedelta(days=1)
        else:
            end = d.replace(month=d.month + 1, day=1) - timedelta(days=1)
        return start.strftime(_DATE_FMT), end.strftime(_DATE_FMT)
    if view == "year":
        start = d.replace(month=1, day=1)
        end = d.replace(month=12, day=31)
        return start.strftime(_DATE_FMT), end.strftime(_DATE_FMT)
    raise ValueError(f"未知视图: {view}")


def check_and_fire_reminders() -> list[dict[str, Any]]:
    """扫描到期未提醒任务，标记 reminded 并返回列表（供轮询推送）。"""
    store = _load_store()
    now = datetime.now()
    fired: list[dict[str, Any]] = []
    changed = False
    for t in store.get("tasks") or []:
        if not isinstance(t, dict):
            continue
        if t.get("status") != "pending" or t.get("reminded"):
            continue
        remind = _parse_dt(t.get("remind_at"))
        if not remind or remind > now:
            continue
        t["reminded"] = True
        t["reminded_at"] = now.strftime(_FMT)
        t["updated_at"] = _now()
        fired.append(_public_task(t))
        changed = True
    if changed:
        _save_store(store)
    return fired


def pending_reminders_for_client() -> list[dict[str, Any]]:
    """返回已触发但前端可能尚未展示过的提醒（reminded 且 pending）。"""
    store = _load_store()
    now = datetime.now()
    out: list[dict[str, Any]] = []
    for t in store.get("tasks") or []:
        if not isinstance(t, dict):
            continue
        if t.get("status") != "pending":
            continue
        remind = _parse_dt(t.get("remind_at"))
        if not remind or remind > now:
            continue
        if not t.get("reminded"):
            continue
        out.append(_public_task(t))
    return out
