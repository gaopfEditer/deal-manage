"""调用外部 WhisprRT `batch_whisperx_nodownload.py`：URL → 转写/整理 → 返回生成文件路径。"""
from __future__ import annotations

import asyncio
import os
import re
import sys
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_WHISPRT_ROOT = ROOT_DIR.parent / "WhisprRT"
SCRIPT_NAME = "batch_whisperx_nodownload.py"

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
        "refined": root / "output" / f"{name}.txt",
    }
    return {k: str(p.resolve()) if p.is_file() else None for k, p in mapping.items()}


def _paths_exist(paths: dict[str, str | None]) -> bool:
    return bool(paths.get("refined") or paths.get("transcript"))


def _remove_existing(root: Path, name: str) -> None:
    for rel in ("subtitles", "logs", "output"):
        p = root / rel / f"{name}.txt"
        if p.is_file():
            p.unlink()


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
    url = (url or "").strip()
    if not url:
        raise ValueError("url 不能为空")

    settings = load_whisper_settings(config)
    root: Path = settings["root"]
    script: Path = settings["script"]
    python: Path = settings["python"]
    timeout = int(settings["timeout_seconds"])
    use_cpu = settings["force_cpu"] if force_cpu is None else bool(force_cpu)

    if not root.is_dir():
        raise FileNotFoundError(f"WhisprRT 目录不存在: {root}")
    if not script.is_file():
        raise FileNotFoundError(f"未找到脚本: {script}")
    if not python.is_file():
        raise FileNotFoundError(f"未找到 Python: {python}")

    name = sanitize_title(title, url)
    paths = collect_output_paths(root, name)

    if _paths_exist(paths) and not force:
        return {
            "ok": True,
            "status": "skipped_existing",
            "name": name,
            "url": url,
            "message": "成品已存在，未重新转写；传 force=true 可覆盖",
            "paths": paths,
            "workdir": str(root),
        }

    if force:
        _remove_existing(root, name)

    cmd = [
        str(python),
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

    async with _run_lock:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(root),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=os.environ.copy(),
        )
        try:
            stdout_b, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise TimeoutError(f"转写超时（>{timeout}s）: {name}")

    log_text = (stdout_b or b"").decode("utf-8", errors="replace")
    paths = collect_output_paths(root, name)
    ok = proc.returncode == 0 and _paths_exist(paths)
    return {
        "ok": ok,
        "status": "success" if ok else "error",
        "name": name,
        "url": url,
        "returncode": proc.returncode,
        "paths": paths,
        "workdir": str(root),
        "stdout_tail": log_text[-4000:] if log_text else "",
        "message": None if ok else "脚本执行失败或未生成转写文件，请查看 stdout_tail",
    }
