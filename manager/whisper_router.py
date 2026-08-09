"""本项目 Whisper API：URL / 标题 → 后台转写 → 实时日志 → 成品路径。"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .whisper_service import (
    get_whisper_job,
    load_whisper_settings,
    sanitize_title,
    start_transcribe_job,
    subscribe_job_events,
    transcribe_url,
)

router = APIRouter(prefix="/api/whisper", tags=["whisper"])


class WhisperTranscribePayload(BaseModel):
    url: str = Field(..., min_length=1, description="音视频链接（YouTube / 币安广场等，脚本支持的 URL）")
    title: str | None = Field(
        None,
        description="标题，用作输出文件名（不含扩展名）；可与 name 二选一",
    )
    name: str | None = Field(
        None,
        description="与 title 同义；两者都传时优先 title",
    )
    force: bool = Field(False, description="若 output/subtitles 已存在同名文件，是否强制重跑")
    force_cpu: bool | None = Field(
        None,
        description="强制 CPU 转写；不传则跟随 config.yaml whisper.force_cpu / WHISPRT_CPU",
    )


def _config() -> dict[str, Any]:
    from .main import load_config

    return load_config()


@router.get("/config")
async def get_whisper_config():
    s = load_whisper_settings(_config())
    root = s["root"]
    script = s["script"]
    python = s["python"]
    return {
        "root": str(root),
        "output_dir": str(s["output_dir"]),
        "engine_ready": bool(script.is_file() and python.is_file() and root.is_dir()),
        "timeout_seconds": s["timeout_seconds"],
        "force_cpu": s["force_cpu"],
        # 兼容旧前端字段（不再在 UI 强调外部路径）
        "script": str(script),
        "script_exists": script.is_file(),
        "python": str(python),
        "python_exists": python.is_file(),
    }


@router.post("/transcribe")
async def post_whisper_transcribe(payload: WhisperTranscribePayload):
    """
    同步转写（适合 curl）。前端请用 /jobs 后台任务，避免长连接卡死服务。
    """
    title = (payload.title or payload.name or "").strip() or None
    try:
        result = await transcribe_url(
            url=payload.url,
            title=title,
            force=payload.force,
            force_cpu=payload.force_cpu,
            config=_config(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"{type(exc).__name__}: {exc}") from exc

    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result)

    result.setdefault("name", sanitize_title(title, payload.url))
    return result


@router.post("/jobs")
async def post_whisper_job(payload: WhisperTranscribePayload):
    """立即返回 job_id，后台转写；用 GET /jobs/{id}/events 拉实时日志。"""
    title = (payload.title or payload.name or "").strip() or None
    try:
        job = await start_transcribe_job(
            url=payload.url,
            title=title,
            force=payload.force,
            force_cpu=payload.force_cpu,
            config=_config(),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"{type(exc).__name__}: {exc}") from exc
    return {
        "ok": True,
        "job_id": job.id,
        "status": job.status,
        "name": sanitize_title(title, payload.url),
    }


@router.get("/jobs/{job_id}")
async def get_whisper_job_status(job_id: str):
    job = get_whisper_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"任务不存在: {job_id}")
    return {
        "job_id": job.id,
        "status": job.status,
        "error": job.error,
        "result": job.result,
        "log_lines": len(job.logs),
    }


@router.get("/jobs/{job_id}/events")
async def get_whisper_job_events(job_id: str):
    """SSE：回放已有日志 + 后续实时输出。"""
    if not get_whisper_job(job_id):
        raise HTTPException(status_code=404, detail=f"任务不存在: {job_id}")

    async def event_stream():
        try:
            async for event in subscribe_job_events(job_id):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as exc:  # noqa: BLE001
            err = {"type": "error", "message": f"{type(exc).__name__}: {exc}"}
            yield f"data: {json.dumps(err, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'end'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# 兼容旧路径：改为创建后台任务后立刻 307 提示用新接口（保留避免前端旧缓存全挂）
@router.post("/transcribe/stream")
async def post_whisper_transcribe_stream_compat(payload: WhisperTranscribePayload):
    title = (payload.title or payload.name or "").strip() or None
    job = await start_transcribe_job(
        url=payload.url,
        title=title,
        force=payload.force,
        force_cpu=payload.force_cpu,
        config=_config(),
    )

    async def event_stream():
        yield f"data: {json.dumps({'type': 'log', 'line': f'>>> job_id={job.id}'}, ensure_ascii=False)}\n\n"
        try:
            async for event in subscribe_job_events(job.id):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as exc:  # noqa: BLE001
            err = {"type": "error", "message": f"{type(exc).__name__}: {exc}"}
            yield f"data: {json.dumps(err, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
