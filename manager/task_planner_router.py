from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import task_planner_service as svc

router = APIRouter(prefix="/api/task-planner", tags=["task-planner"])


class TaskPlannerStartBody(BaseModel):
    initial_input: str = Field(..., min_length=1, max_length=8000)


class TaskPlannerChatBody(BaseModel):
    user_input: str = Field(default="", max_length=8000)
    force_complete: bool = False


@router.get("/sessions")
def list_sessions():
    return {"items": svc.list_sessions()}


@router.get("/sessions/{session_id}")
def get_session(session_id: str):
    try:
        return svc.get_session(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="会话不存在") from exc


@router.post("/sessions")
async def create_session(body: TaskPlannerStartBody):
    try:
        session = svc.create_session(body.initial_input)
        result = await svc.chat_session(session["id"], body.initial_input)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/chat")
async def chat_session(session_id: str, body: TaskPlannerChatBody):
    try:
        return await svc.chat_session(
            session_id,
            body.user_input,
            force_complete=body.force_complete,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="会话不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/start")
async def start_and_chat(body: TaskPlannerStartBody):
    """创建会话并处理首条输入（等价于 create + chat）。"""
    try:
        return await svc.start_and_chat(body.initial_input)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
