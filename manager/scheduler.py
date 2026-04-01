from __future__ import annotations

import asyncio
import datetime as dt
import os
import signal
import subprocess
import traceback
import shlex
import sys
from dataclasses import dataclass, field
from collections import deque
from pathlib import Path
from typing import Any


@dataclass
class ScriptRuntime:
    status: str = "online"  # online | running | error
    last_run_time: str | None = None
    last_exit_code: int | None = None
    last_error: str | None = None
    last_callback_time: str | None = None
    last_callback_result: Any | None = None
    task: asyncio.Task | None = None
    process: subprocess.Popen[str] | None = None
    log_queue: asyncio.Queue[str] = field(default_factory=asyncio.Queue)
    callback_logs: deque[dict[str, Any]] = field(default_factory=lambda: deque(maxlen=200))


class ScriptScheduler:
    def __init__(self, config: dict[str, Any], root_dir: Path):
        self.config = config
        self.root_dir = root_dir
        self._scripts = {item["id"]: item for item in config.get("scripts", [])}
        self._runtime: dict[str, ScriptRuntime] = {
            script_id: ScriptRuntime() for script_id in self._scripts
        }
        self._periodic_tasks: list[asyncio.Task] = []
        self._lock = asyncio.Lock()

    def list_cards(self) -> list[dict[str, Any]]:
        cards: list[dict[str, Any]] = []
        for script_id, script_cfg in self._scripts.items():
            runtime = self._runtime[script_id]
            cards.append(
                {
                    "id": script_id,
                    "name": script_cfg.get("name", script_id),
                    "icon": script_cfg.get("icon", "📄"),
                    "status": runtime.status,
                    "last_run_time": runtime.last_run_time,
                    "last_exit_code": runtime.last_exit_code,
                    "last_error": runtime.last_error,
                    "last_callback_time": runtime.last_callback_time,
                    "last_callback_result": runtime.last_callback_result,
                    "schedule": script_cfg.get("schedule", {}),
                }
            )
        return cards

    def set_callback_result(self, script_id: str, result: Any) -> dict[str, Any]:
        if script_id not in self._runtime:
            raise KeyError(f"Script '{script_id}' not found")
        runtime = self._runtime[script_id]
        runtime.last_callback_time = self._now()
        runtime.last_callback_result = result
        return {
            "script_id": script_id,
            "callback_time": runtime.last_callback_time,
            "result": runtime.last_callback_result,
        }

    def get_callback_result(self, script_id: str) -> dict[str, Any]:
        if script_id not in self._runtime:
            raise KeyError(f"Script '{script_id}' not found")
        runtime = self._runtime[script_id]
        return {
            "script_id": script_id,
            "callback_time": runtime.last_callback_time,
            "result": runtime.last_callback_result,
        }

    async def push_callback_log(
        self, script_id: str, message: str, level: str = "INFO", source: str = "callback"
    ) -> dict[str, Any]:
        if script_id not in self._runtime:
            raise KeyError(f"Script '{script_id}' not found")
        runtime = self._runtime[script_id]
        item = {
            "time": self._now(),
            "level": level.upper(),
            "source": source,
            "message": message,
        }
        runtime.callback_logs.append(item)
        await runtime.log_queue.put(
            f"[{item['time']}] [{item['source']}] [{item['level']}] {item['message']}"
        )
        return {"script_id": script_id, "item": item}

    def get_callback_logs(self, script_id: str, limit: int = 50) -> dict[str, Any]:
        if script_id not in self._runtime:
            raise KeyError(f"Script '{script_id}' not found")
        runtime = self._runtime[script_id]
        logs = list(runtime.callback_logs)[-max(1, min(limit, 200)) :]
        return {"script_id": script_id, "items": logs}

    async def start_periodic_jobs(self) -> None:
        for script in self.config.get("scripts", []):
            schedule = script.get("schedule", {})
            mode = schedule.get("mode")
            if mode == "interval":
                seconds = int(schedule.get("seconds", 0))
                if seconds <= 0:
                    continue
                self._periodic_tasks.append(
                    asyncio.create_task(self._interval_runner(script["id"], seconds))
                )
            elif mode == "once" and bool(schedule.get("enabled", False)):
                self._periodic_tasks.append(
                    asyncio.create_task(self.trigger(script["id"], "once"))
                )

    async def shutdown(self) -> None:
        for task in self._periodic_tasks:
            task.cancel()
        await asyncio.gather(*self._periodic_tasks, return_exceptions=True)

    async def _interval_runner(self, script_id: str, seconds: int) -> None:
        while True:
            await asyncio.sleep(seconds)
            await self.trigger(script_id, "interval")

    async def trigger(self, script_id: str, action: str, keyword: str | None = None) -> None:
        if script_id not in self._scripts:
            raise KeyError(f"Script '{script_id}' not found")
        async with self._lock:
            runtime = self._runtime[script_id]
            if runtime.task and not runtime.task.done():
                await runtime.log_queue.put(
                    f"[{self._now()}] Script is already running, skip this trigger."
                )
                return
            runtime.task = asyncio.create_task(self._run_subprocess(script_id, action, keyword))

    async def stop(self, script_id: str) -> dict[str, Any]:
        if script_id not in self._scripts:
            raise KeyError(f"Script '{script_id}' not found")
        runtime = self._runtime[script_id]
        proc = runtime.process
        if not proc or proc.poll() is not None:
            await runtime.log_queue.put(f"[{self._now()}] No running process to stop.")
            return {"script_id": script_id, "stopped": False, "message": "not running"}

        await runtime.log_queue.put(f"[{self._now()}] Stopping process pid={proc.pid} ...")
        if os.name == "nt":
            proc.terminate()
        else:
            # macOS/Linux: terminate process group to avoid orphan children.
            os.killpg(proc.pid, signal.SIGTERM)
        try:
            await asyncio.wait_for(asyncio.to_thread(proc.wait), timeout=5)
        except asyncio.TimeoutError:
            await runtime.log_queue.put(
                f"[{self._now()}] Terminate timeout, force kill pid={proc.pid}"
            )
            if os.name == "nt":
                proc.kill()
            else:
                os.killpg(proc.pid, signal.SIGKILL)
            await asyncio.to_thread(proc.wait)

        runtime.status = "online"
        runtime.last_exit_code = proc.returncode
        runtime.process = None
        await runtime.log_queue.put(f"[{self._now()}] Process stopped, exit={proc.returncode}")
        return {"script_id": script_id, "stopped": True, "exit_code": proc.returncode}

    async def _run_subprocess(self, script_id: str, action: str, keyword: str | None) -> None:
        script_cfg = self._scripts[script_id]
        runtime = self._runtime[script_id]
        runtime.status = "running"
        runtime.last_error = None
        runtime.last_run_time = self._now()

        cmd, run_cwd = self._build_command(script_cfg, action, keyword)
        await runtime.log_queue.put(f"[{self._now()}] Execute: {' '.join(cmd)}")
        try:
            env = os.environ.copy()
            env["PYTHONIOENCODING"] = "utf-8"
            proc = subprocess.Popen(
                cmd,
                cwd=str(run_cwd),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                env=env,
                # macOS/Linux: create a new session so we can stop entire process group.
                start_new_session=(os.name != "nt"),
            )
            runtime.process = proc

            if proc.stdout is None:
                raise RuntimeError("Subprocess stdout pipe is not available")
            while True:
                line = await asyncio.to_thread(proc.stdout.readline)
                if not line and proc.poll() is not None:
                    break
                if not line:
                    await asyncio.sleep(0.05)
                    continue
                await runtime.log_queue.put(line.rstrip())

            exit_code = await asyncio.to_thread(proc.wait)
            runtime.last_exit_code = exit_code
            if exit_code == 0:
                runtime.status = "online"
                await runtime.log_queue.put(f"[{self._now()}] Exit code: 0")
            else:
                runtime.status = "error"
                runtime.last_error = f"Exit code {exit_code}"
                await runtime.log_queue.put(f"[{self._now()}] Exit code: {exit_code}")
        except Exception as exc:  # noqa: BLE001
            runtime.status = "error"
            err_text = f"{type(exc).__name__}: {exc!r}"
            runtime.last_error = err_text
            await runtime.log_queue.put(f"[{self._now()}] Scheduler error: {err_text}")
            await runtime.log_queue.put(
                f"[{self._now()}] Traceback:\n{traceback.format_exc().rstrip()}"
            )
        finally:
            runtime.process = None

    async def stream_logs(self, script_id: str):
        if script_id not in self._runtime:
            raise KeyError(f"Script '{script_id}' not found")
        queue = self._runtime[script_id].log_queue
        while True:
            line = await queue.get()
            yield line

    def _resolve_project_dir(self, script_path_raw: str) -> Path:
        base = Path(script_path_raw)
        if not base.is_absolute():
            base = self.root_dir / base
        if base.is_dir():
            return base
        if base.is_file():
            return base.parent
        raise FileNotFoundError(
            f"script_path is not a valid file or directory: {base}"
        )

    @staticmethod
    def _path_is_under(child: Path, parent: Path) -> bool:
        try:
            child.resolve().relative_to(parent.resolve())
            return True
        except ValueError:
            return False

    def _resolve_python_executable(
        self, project_dir: Path, venv_path: str | None, script_path_raw: str
    ) -> str:
        """解析子进程使用的 Python：始终以目标项目目录为准，禁止在误配时回退到 deal-manage 的 venv。"""
        if not project_dir.is_dir():
            raise FileNotFoundError(
                f"script_path is not an existing directory: {project_dir}. "
                "Fix script_path in config."
            )

        if venv_path:
            venv_root = Path(venv_path)
            if not venv_root.is_absolute():
                venv_root = project_dir / venv_root

            candidates: list[Path] = [venv_root]
            if not Path(venv_path).is_absolute():
                vname = Path(venv_path).name
                if vname.startswith("."):
                    candidates.append(project_dir / vname.lstrip("."))
                else:
                    candidates.append(project_dir / f".{vname}")

            checked: list[str] = []
            for root in candidates:
                if os.name == "nt":
                    candidate = root / "Scripts" / "python.exe"
                else:
                    candidate = root / "bin" / "python"
                checked.append(str(candidate))
                if candidate.exists():
                    return str(candidate)
            raise FileNotFoundError(
                "Configured venv python not found. "
                f"Checked: {checked}. "
                f"script_path='{script_path_raw}', venv_path='{venv_path}'."
            )

        # 未配置 venv：本仓库内脚本仍用当前解释器；对外部项目禁止用 deal-manage 的 Python。
        root = self.root_dir
        if self._path_is_under(project_dir, root):
            return sys.executable

        for name in (".venv", "venv"):
            vr = project_dir / name
            if os.name == "nt":
                candidate = vr / "Scripts" / "python.exe"
            else:
                candidate = vr / "bin" / "python"
            if candidate.exists():
                return str(candidate)

        exe = Path(sys.executable)
        if self._path_is_under(exe, root):
            raise FileNotFoundError(
                "Refusing to use deal-manage's interpreter for an external project. "
                f"project_dir={project_dir}. "
                "Set venv_path in config or create .venv / venv under that project."
            )
        return sys.executable

    def _build_command(
        self, script_cfg: dict[str, Any], action: str, keyword: str | None
    ) -> tuple[list[str], Path]:
        script_path_raw = str(script_cfg.get("script_path", "."))
        run_expr = script_cfg.get("run")
        venv_path = script_cfg.get("venv_path")
        project_dir = self._resolve_project_dir(script_path_raw)
        python_executable = self._resolve_python_executable(
            project_dir, venv_path, script_path_raw
        )
        run_cwd = self.root_dir

        if run_expr:
            run_cwd = project_dir
            tokens = shlex.split(str(run_expr), posix=False)
            if tokens and tokens[0].lower() in {"python", "python3", "py"}:
                tokens[0] = python_executable
            cmd = tokens + ["--action", action]
            if keyword:
                cmd.extend(["--keyword", keyword])
            return cmd, run_cwd

        # 兼容旧配置：script_path 直接写脚本文件路径
        script_path = Path(script_path_raw)
        if not script_path.is_absolute():
            script_path = self.root_dir / script_path
        cmd = [python_executable, str(script_path), "--action", action]
        if keyword:
            cmd.extend(["--keyword", keyword])
        return cmd, run_cwd

    @staticmethod
    def _now() -> str:
        return dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
