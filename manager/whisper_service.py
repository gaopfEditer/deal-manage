"""本项目 Whisper 转写服务：URL → 拉流转写 → 成品写入配置的 output 目录。"""
from __future__ import annotations

import asyncio
import os
import re
import shutil
import sys
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_WHISPRT_ROOT = ROOT_DIR.parent / "WhisprRT"
SCRIPT_NAME = "batch_whisperx_nodownload.py"
OUTPUT_SUBDIR = "output"

_run_lock = asyncio.Lock()


def load_whisper_settings(config: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = (config or {}).get("whisper") or {}
    root_raw = (
        os.environ.get("WHISPRT_ROOT", "").strip()
        or str(cfg.get("root") or "").strip()
        or str(DEFAULT_WHISPRT_ROOT)
    )
    root = Path(root_raw).expanduser().resolve()
    python_raw = (
        os.environ.get("WHISPRT_PYTHON", "").strip()
        or str(cfg.get("python") or "").strip()
        or ""
    )
    python = Path(python_raw).expanduser() if python_raw else _default_python(root)
    timeout = int(os.environ.get("WHISPRT_TIMEOUT_SECONDS", "") or cfg.get("timeout_seconds") or 3600)
    force_cpu = _truthy(os.environ.get("WHISPRT_CPU")) or _truthy(cfg.get("force_cpu"))
    return {
        "root": root,
        "script": root / SCRIPT_NAME,
        "python": Path(python),
        "timeout_seconds": max(60, timeout),
        "force_cpu": bool(force_cpu),
        "output_dir": root / OUTPUT_SUBDIR,
    }


def _truthy(v: Any) -> bool:
    if isinstance(v, bool):
        return v
    if v is None:
        return False
    return str(v).strip().lower() in {"1", "true", "yes", "y", "on"}


def _default_python(root: Path) -> Path:
    candidates = [
        root / ".venv" / "Scripts" / "python.exe",
        root / ".venv" / "bin" / "python",
        root / "venv" / "Scripts" / "python.exe",
        root / "venv" / "bin" / "python",
    ]
    for p in candidates:
        if p.is_file():
            return p
    return Path(sys.executable)


def sanitize_title(title: str | None, url: str) -> str:
    raw = (title or "").strip()
    if not raw:
        raw = _default_name_from_url(url)
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", raw).strip(" ._")
    cleaned = re.sub(r"\s+", "_", cleaned)
    if not cleaned:
        cleaned = "video"
    return cleaned[:120]


def _default_name_from_url(url: str) -> str:
    try:
        from urllib.parse import urlparse

        p = urlparse(url)
        seg = (p.path or "").rstrip("/").split("/")[-1] or "video"
        seg = seg.split("?")[0]
        seg = re.sub(r"[^\w\u4e00-\u9fff\-]", "_", seg).strip("_")
        return (seg or "video")[:120]
    except Exception:
        return "video"


def collect_output_paths(root: Path, name: str) -> dict[str, str | None]:
    mapping = {
        "transcript": root / "subtitles" / f"{name}.txt",
        "log": root / "logs" / f"{name}.txt",
        "refined": root / OUTPUT_SUBDIR / f"{name}.txt",
    }
    return {k: str(p.resolve()) if p.is_file() else None for k, p in mapping.items()}


def ensure_primary_under_output(root: Path, name: str) -> Path | None:
    """
    保证成品落在 {root}/output/{name}.txt。
    若整理稿已在 output 则直接返回；否则把 subtitles 原稿复制过去。
    """
    out_dir = root / OUTPUT_SUBDIR
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{name}.txt"
    if out.is_file():
        return out.resolve()
    src = root / "subtitles" / f"{name}.txt"
    if src.is_file():
        shutil.copy2(src, out)
        return out.resolve()
    return None


def read_primary_content(root: Path, name: str, *, max_chars: int = 200_000) -> dict[str, Any]:
    """优先读 output（整理稿 / 已同步成品），否则读 subtitles。"""
    ensure_primary_under_output(root, name)
    for kind, rel in (("refined", OUTPUT_SUBDIR), ("transcript", "subtitles")):
        p = root / rel / f"{name}.txt"
        if not p.is_file():
            continue
        text = p.read_text(encoding="utf-8", errors="replace")
        truncated = len(text) > max_chars
        if truncated:
            text = text[:max_chars]
        return {
            "kind": kind,
            "path": str(p.resolve()),
            "text": text,
            "truncated": truncated,
        }
    return {"kind": None, "path": None, "text": "", "truncated": False}


def _paths_exist(paths: dict[str, str | None]) -> bool:
    return bool(paths.get("refined") or paths.get("transcript"))


def _remove_existing(root: Path, name: str) -> None:
    for rel in ("subtitles", "logs", OUTPUT_SUBDIR):
        p = root / rel / f"{name}.txt"
        if p.is_file():
            p.unlink()


def _build_cmd(
    *,
    python: Path,
    script: Path,
    url: str,
    name: str,
    use_cpu: bool,
) -> list[str]:
    cmd = [
        str(python),
        "-u",
        str(script),
        "--mode",
        "file",
        "--url",
        url,
        "--name",
        name,
    ]
    if use_cpu:
        cmd.append("--cpu")
    return cmd


def _child_env() -> dict[str, str]:
    env = os.environ.copy()
    env.setdefault("PYTHONUNBUFFERED", "1")
    # 避免继承父进程（uvicorn）里已关闭/异常的 stdin，导致子 Python
    # Fatal: init_sys_streams / Bad file descriptor
    env.pop("PYTHONSTARTUP", None)
    return env


async def _iter_process_output_lines(proc: asyncio.subprocess.Process):
    """逐行产出 stdout；把 \\r 进度刷新拆成独立行，便于前端实时显示。"""
    assert proc.stdout is not None
    buf = ""
    while True:
        chunk = await proc.stdout.read(1024)
        if not chunk:
            break
        text = chunk.decode("utf-8", errors="replace").replace("\r\n", "\n").replace("\r", "\n")
        buf += text
        while "\n" in buf:
            line, buf = buf.split("\n", 1)
            yield line
    if buf:
        yield buf


def _final_result(
    *,
    root: Path,
    name: str,
    url: str,
    returncode: int | None,
    log_text: str,
) -> dict[str, Any]:
    paths = collect_output_paths(root, name)
    ok = returncode == 0 and _paths_exist(paths)
    return {
        "ok": ok,
        "status": "success" if ok else "error",
        "name": name,
        "url": url,
        "returncode": returncode,
        "paths": paths,
        "content": read_primary_content(root, name),
        "workdir": str(root),
        "stdout_tail": log_text[-8000:] if log_text else "",
        "message": None if ok else "脚本执行失败或未生成转写文件，请查看实时日志",
    }


async def iter_transcribe_events(
    *,
    url: str,
    title: str | None = None,
    force: bool = False,
    force_cpu: bool | None = None,
    config: dict[str, Any] | None = None,
):
    """
    异步产出转写事件：
    - {"type":"log","line":"..."}
    - {"type":"done","result":{...}}
    - {"type":"error","message":"..."}
    """
    url = (url or "").strip()
    if not url:
        yield {"type": "error", "message": "url 不能为空"}
        return

    settings = load_whisper_settings(config)
    root: Path = settings["root"]
    script: Path = settings["script"]
    python: Path = settings["python"]
    timeout = int(settings["timeout_seconds"])
    use_cpu = settings["force_cpu"] if force_cpu is None else bool(force_cpu)

    if not root.is_dir():
        yield {"type": "error", "message": f"Whisper 引擎目录不存在: {root}"}
        return
    if not script.is_file():
        yield {"type": "error", "message": f"Whisper 引擎脚本缺失: {script.name}"}
        return
    if not python.is_file():
        yield {"type": "error", "message": f"Whisper 运行环境 Python 不可用: {python}"}
        return

    name = sanitize_title(title, url)
    output_dir = (root / OUTPUT_SUBDIR).resolve()
    # 先尽量把已有成品归一到 output/
    await asyncio.to_thread(ensure_primary_under_output, root, name)
    paths = collect_output_paths(root, name)

    yield {"type": "log", "line": ">>> [deal-manage Whisper] 本服务开始处理"}
    yield {
        "type": "log",
        "line": f">>> 任务 name={name!r}  force={force}  cpu={use_cpu}",
    }
    yield {"type": "log", "line": f">>> 获取流地址: {url}"}
    yield {"type": "log", "line": f">>> 成品目录: {output_dir}"}
    yield {"type": "log", "line": f">>> 目标文件: {output_dir / f'{name}.txt'}"}

    if _paths_exist(paths) and not force:
        content = await asyncio.to_thread(read_primary_content, root, name)
        paths = await asyncio.to_thread(collect_output_paths, root, name)
        result = {
            "ok": True,
            "status": "skipped_existing",
            "name": name,
            "url": url,
            "message": "成品已存在，未重新转写；勾选强制重跑可覆盖",
            "paths": paths,
            "content": content,
            "workdir": str(root),
            "output_dir": str(output_dir),
            "stdout_tail": "",
        }
        yield {
            "type": "log",
            "line": f">>> 跳过：已存在成品 {output_dir / f'{name}.txt'}",
        }
        yield {"type": "done", "result": result}
        return

    if force:
        _remove_existing(root, name)
        yield {"type": "log", "line": ">>> 已清除同名旧文件，开始重跑"}

    cmd = _build_cmd(python=python, script=script, url=url, name=name, use_cpu=use_cpu)
    yield {"type": "log", "line": ">>> 启动本服务转写引擎…"}
    yield {"type": "log", "line": ">>> （以下为引擎实时进度）"}

    log_parts: list[str] = []
    proc: asyncio.subprocess.Process | None = None
    async with _run_lock:
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=str(root),
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                env=_child_env(),
                start_new_session=(os.name != "nt"),
            )
            deadline = asyncio.get_running_loop().time() + timeout
            async for line in _iter_process_output_lines(proc):
                if asyncio.get_running_loop().time() > deadline:
                    raise TimeoutError(f"转写超时（>{timeout}s）: {name}")
                log_parts.append(line)
                yield {"type": "log", "line": line}
            await asyncio.wait_for(
                proc.wait(),
                timeout=max(1.0, deadline - asyncio.get_running_loop().time()),
            )
        except (asyncio.TimeoutError, TimeoutError) as exc:
            yield {"type": "error", "message": str(exc) if str(exc) else f"转写超时（>{timeout}s）: {name}"}
            return
        except asyncio.CancelledError:
            raise
        finally:
            if proc is not None and proc.returncode is None:
                try:
                    proc.kill()
                except ProcessLookupError:
                    pass
                try:
                    await proc.wait()
                except Exception:
                    pass

    if proc is None:
        yield {"type": "error", "message": "未能启动转写进程"}
        return

    log_text = "\n".join(log_parts)
    # 大文件读盘放到线程，避免卡住事件循环导致整站 API 无响应
    await asyncio.to_thread(ensure_primary_under_output, root, name)
    content = await asyncio.to_thread(read_primary_content, root, name)
    paths = await asyncio.to_thread(collect_output_paths, root, name)
    ok = proc.returncode == 0 and _paths_exist(paths)
    out_path = (root / OUTPUT_SUBDIR / f"{name}.txt").resolve()
    if ok:
        yield {"type": "log", "line": f"✅ 成品已写入: {out_path}"}
    result = {
        "ok": ok,
        "status": "success" if ok else "error",
        "name": name,
        "url": url,
        "returncode": proc.returncode,
        "paths": paths,
        "content": content,
        "workdir": str(root),
        "output_dir": str((root / OUTPUT_SUBDIR).resolve()),
        "stdout_tail": log_text[-8000:] if log_text else "",
        "message": None if ok else "脚本执行失败或未生成转写文件，请查看实时日志",
    }
    yield {"type": "done", "result": result}


async def transcribe_url(
    *,
    url: str,
    title: str | None = None,
    force: bool = False,
    force_cpu: bool | None = None,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    调用 WhisprRT 脚本转写单个 URL。
    返回 status / paths（transcript / log / refined 绝对路径）。
    """
    last_result: dict[str, Any] | None = None
    async for event in iter_transcribe_events(
        url=url,
        title=title,
        force=force,
        force_cpu=force_cpu,
        config=config,
    ):
        if event.get("type") == "error":
            raise RuntimeError(str(event.get("message") or "转写失败"))
        if event.get("type") == "done":
            last_result = event.get("result")
    if not last_result:
        raise RuntimeError("转写未返回结果")
    return last_result


@dataclass
class WhisperJob:
    id: str
    status: str = "queued"  # queued | running | success | error | skipped_existing
    logs: deque[str] = field(default_factory=lambda: deque(maxlen=8000))
    result: dict[str, Any] | None = None
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    subscribers: list[asyncio.Queue] = field(default_factory=list)
    task: asyncio.Task | None = None


_jobs: dict[str, WhisperJob] = {}


def get_whisper_job(job_id: str) -> WhisperJob | None:
    return _jobs.get(job_id)


def _broadcast_job(job: WhisperJob, event: dict[str, Any]) -> None:
    alive: list[asyncio.Queue] = []
    for q in job.subscribers:
        try:
            q.put_nowait(event)
            alive.append(q)
        except asyncio.QueueFull:
            alive.append(q)
        except Exception:
            continue
    job.subscribers = alive


async def _run_whisper_job(
    job: WhisperJob,
    *,
    url: str,
    title: str | None,
    force: bool,
    force_cpu: bool | None,
    config: dict[str, Any] | None,
) -> None:
    job.status = "running"
    try:
        async for event in iter_transcribe_events(
            url=url,
            title=title,
            force=force,
            force_cpu=force_cpu,
            config=config,
        ):
            et = event.get("type")
            if et == "log":
                line = str(event.get("line") or "")
                job.logs.append(line)
                _broadcast_job(job, {"type": "log", "line": line})
            elif et == "error":
                msg = str(event.get("message") or "转写失败")
                job.status = "error"
                job.error = msg
                _broadcast_job(job, {"type": "error", "message": msg})
            elif et == "done":
                result = event.get("result") or {}
                job.result = result
                job.status = str(result.get("status") or ("success" if result.get("ok") else "error"))
                _broadcast_job(job, {"type": "done", "result": result})
    except asyncio.CancelledError:
        job.status = "error"
        job.error = "任务已取消"
        _broadcast_job(job, {"type": "error", "message": job.error})
        raise
    except Exception as exc:  # noqa: BLE001
        job.status = "error"
        job.error = f"{type(exc).__name__}: {exc}"
        _broadcast_job(job, {"type": "error", "message": job.error})
    finally:
        _broadcast_job(job, {"type": "end"})


async def start_transcribe_job(
    *,
    url: str,
    title: str | None = None,
    force: bool = False,
    force_cpu: bool | None = None,
    config: dict[str, Any] | None = None,
) -> WhisperJob:
    job_id = uuid.uuid4().hex[:12]
    job = WhisperJob(id=job_id)
    _jobs[job_id] = job
    # 限制内存：只保留最近 30 个任务
    if len(_jobs) > 30:
        oldest = sorted(_jobs.values(), key=lambda j: j.created_at)[: max(0, len(_jobs) - 30)]
        for j in oldest:
            if j.status in {"success", "error", "skipped_existing"}:
                _jobs.pop(j.id, None)
    job.task = asyncio.create_task(
        _run_whisper_job(
            job,
            url=url,
            title=title,
            force=force,
            force_cpu=force_cpu,
            config=config,
        )
    )
    return job


async def subscribe_job_events(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        yield {"type": "error", "message": f"任务不存在: {job_id}"}
        yield {"type": "end"}
        return

    q: asyncio.Queue = asyncio.Queue(maxsize=2000)
    # 先回放已有日志，再订阅后续
    for line in list(job.logs):
        yield {"type": "log", "line": line}
    if job.result is not None:
        yield {"type": "done", "result": job.result}
        yield {"type": "end"}
        return
    if job.status == "error" and job.error:
        yield {"type": "error", "message": job.error}
        yield {"type": "end"}
        return

    job.subscribers.append(q)
    try:
        while True:
            event = await q.get()
            yield event
            if event.get("type") == "end":
                break
    finally:
        if q in job.subscribers:
            job.subscribers.remove(q)
