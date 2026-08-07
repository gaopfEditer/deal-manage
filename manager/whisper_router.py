"""WhisprRT 对外 API：传入 URL / 标题，触发流转写并返回生成文件路径。"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .whisper_service import load_whisper_settings, sanitize_title, transcribe_url

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
        "script": str(script),
        "script_exists": script.is_file(),
        "python": str(python),
        "python_exists": python.is_file(),
        "timeout_seconds": s["timeout_seconds"],
        "force_cpu": s["force_cpu"],
    }


@router.post("/transcribe")
async def post_whisper_transcribe(payload: WhisperTranscribePayload):
    """
    调用 WhisprRT `batch_whisperx_nodownload.py`：
    拉流 → faster-whisper 转写 →（可选）Qwen 整理摘要。

    成功时 `paths` 含：
    - transcript: subtitles/{name}.txt（带时间戳原稿）
    - log: logs/{name}.txt
    - refined: output/{name}.txt（摘要+全文，Qwen 成功时才有）
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

    # 规范化：保证响应里带上最终 name（即使客户端没传 title）
    result.setdefault("name", sanitize_title(title, payload.url))
    return result
