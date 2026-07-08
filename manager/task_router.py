from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from . import task_service as svc

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


class TaskCreateBody(BaseModel):
    content: str = Field(..., min_length=1, max_length=50000)
    title: str | None = Field(default=None, max_length=120)
    due_at: str = Field(..., description="YYYY-MM-DD HH:MM:SS 或 YYYY-MM-DD")
    remind_at: str | None = Field(default=None, description="默认与 due_at 相同")


class TaskUpdateBody(BaseModel):
    content: str | None = Field(default=None, max_length=50000)
    title: str | None = Field(default=None, max_length=120)
    due_at: str | None = None
    remind_at: str | None = None
    status: str | None = None
    reset_reminder: bool = False


class TaskCompleteBody(BaseModel):
    done: bool = True


@router.get("")
def list_tasks(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    anchor: str | None = None,
    view: str | None = Query(default=None, pattern="^(day|week|month|year)$"),
    status: str | None = None,
):
    df, dt = date_from, date_to
    if anchor and view:
        try:
            df, dt = svc.range_for_view(anchor, view)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"items": svc.list_tasks(date_from=df, date_to=dt, status=status)}


@router.get("/reminders/check")
async def check_reminders():
    """触发到期提醒扫描，返回本次新触发的任务。"""
    fired = await asyncio.to_thread(svc.check_and_fire_reminders)
    return {"items": fired}


@router.get("/reminders/pending")
def pending_reminders():
    """已到期、待处理的任务（用于前端补弹通知）。"""
    return {"items": svc.pending_reminders_for_client()}


@router.get("/{task_id}")
def get_task(task_id: str):
    try:
        return svc.get_task(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="任务不存在") from exc


@router.post("")
def create_task(body: TaskCreateBody):
    try:
        return svc.create_task(
            content=body.content,
            title=body.title,
            due_at=body.due_at,
            remind_at=body.remind_at,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/{task_id}")
def update_task(task_id: str, body: TaskUpdateBody):
    try:
        fields = body.model_dump(exclude_unset=True)
        return svc.update_task(task_id, **fields)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="任务不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/{task_id}")
def delete_task(task_id: str):
    try:
        svc.delete_task(task_id)
        return {"ok": True}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="任务不存在") from exc


@router.post("/{task_id}/complete")
def complete_task(task_id: str, body: TaskCompleteBody | None = None):
    done = body.done if body else True
    try:
        return svc.complete_task(task_id, done=done)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="任务不存在") from exc
