from __future__ import annotations

import asyncio
import datetime as dt
import os
import signal
import json
import subprocess
import traceback
import shlex
import sys
from dataclasses import dataclass, field
from collections import deque
from pathlib import Path
from typing import Any
import time

import httpx


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
        self._promat_dir = self.root_dir / "promat"

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

    async def clear_logs(self, script_id: str) -> dict[str, Any]:
        if script_id not in self._runtime:
            raise KeyError(f"Script '{script_id}' not found")
        runtime = self._runtime[script_id]
        q = runtime.log_queue
        cleared = 0
        while True:
            try:
                q.get_nowait()
                cleared += 1
            except asyncio.QueueEmpty:
                break
        return {"script_id": script_id, "cleared": cleared}

    async def _run_subprocess(self, script_id: str, action: str, keyword: str | None) -> None:
        script_cfg = self._scripts[script_id]
        runtime = self._runtime[script_id]
        runtime.status = "running"
        runtime.last_error = None
        runtime.last_run_time = self._now()

        # 如果脚本依赖 Chrome DevTools Protocol（CDP），需要先验证 9222 端口可连通
        if bool(script_cfg.get("cdp", False)):
            await self._wait_for_cdp(runtime)

        cmd, run_cwd = self._build_command(script_cfg, action, keyword)
        await runtime.log_queue.put(f"[{self._now()}] Execute: {' '.join(cmd)}")
        collected: list[str] = []
        collected_chars = 0
        max_collect_chars = int(os.getenv("PROMAT_MAX_COLLECT_CHARS", "50000"))
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
                decoded = line.rstrip()
                await runtime.log_queue.put(decoded)
                if collected_chars < max_collect_chars:
                    collected.append(decoded)
                    collected_chars += len(decoded) + 1

            stdout_text = "\n".join(collected)
            if not stdout_text:
                stdout_text = ""

            exit_code = await asyncio.to_thread(proc.wait)
            runtime.last_exit_code = exit_code
            if exit_code == 0:
                runtime.status = "online"
                await runtime.log_queue.put(f"[{self._now()}] Exit code: 0")
            else:
                runtime.status = "error"
                runtime.last_error = f"Exit code {exit_code}"
                await runtime.log_queue.put(f"[{self._now()}] Exit code: {exit_code}")
            await self._maybe_promat_analyze(
                script_id=script_id,
                script_cfg=script_cfg,
                runtime=runtime,
                action=action,
                keyword=keyword,
                exit_code=exit_code,
                stdout_text=stdout_text,
            )
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

    async def _wait_for_cdp(self, runtime: ScriptRuntime) -> None:
        host = os.getenv("CDP_HOST", "127.0.0.1").strip() or "127.0.0.1"
        port = int(os.getenv("CDP_PORT", "9222").strip() or "9222")
        max_wait_seconds = float(os.getenv("CDP_WAIT_MAX_SECONDS", "30").strip() or "30")
        sleep_seconds = float(os.getenv("CDP_WAIT_INTERVAL_SECONDS", "0.5").strip() or "0.5")

        await runtime.log_queue.put(
            f"[{self._now()}] CDP dependency: wait for {host}:{port} ..."
        )
        deadline = time.monotonic() + max_wait_seconds

        last_exc: Exception | None = None
        while time.monotonic() < deadline:
            try:
                # 这里不需要完整协议握手，只要能建立 TCP 连接即可
                fut = asyncio.open_connection(host=host, port=port)
                reader, writer = await asyncio.wait_for(fut, timeout=2.0)
                writer.close()
                await writer.wait_closed()
                await runtime.log_queue.put(
                    f"[{self._now()}] CDP port ready: {host}:{port}"
                )
                return
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                await asyncio.sleep(sleep_seconds)

        raise TimeoutError(
            f"CDP port not reachable within {max_wait_seconds}s: {host}:{port}. "
            f"Last error: {type(last_exc).__name__}: {last_exc!r}"
        )

    async def stream_logs(self, script_id: str):
        if script_id not in self._runtime:
            raise KeyError(f"Script '{script_id}' not found")
        queue = self._runtime[script_id].log_queue
        while True:
            line = await queue.get()
            yield line

    def _resolve_promat_path(self, script_cfg: dict[str, Any]) -> Path | None:
        project_id = str(script_cfg.get("project_id") or "").strip()
        script_key = str(script_cfg.get("script_key") or "").strip()
        if not project_id or not script_key:
            return None

        candidates = [
            f"{project_id}{script_key}.promat",
            f"{project_id}-{script_key}.promat",
            f"{project_id}_{script_key}.promat",
            f"{project_id}{script_key}.prompt",
            f"{project_id}-{script_key}.prompt",
            f"{project_id}_{script_key}.prompt",
        ]
        for name in candidates:
            p = self._promat_dir / name
            if p.exists():
                return p
        return None

    async def _maybe_promat_analyze(
        self,
        *,
        runtime: ScriptRuntime,
        script_id: str,
        script_cfg: dict[str, Any],
        action: str,
        keyword: str | None,
        exit_code: int | None,
        stdout_text: str,
    ) -> None:
        # 产品规则：先判断 use_agent，再判断 promat 模板是否存在
        if not bool(script_cfg.get("use_agent", False)):
            return
        # 归档/同步阶段不再分析，避免递归触发
        if action == "sync":
            return

        promat_path = self._resolve_promat_path(script_cfg)
        if not promat_path:
            return

        try:
            template = promat_path.read_text(encoding="utf-8", errors="replace")
        except Exception as exc:  # noqa: BLE001
            await runtime.log_queue.put(
                f"[{self._now()}] PROMAT read failed: {type(exc).__name__}: {exc!r}"
            )
            return

        # PROMAT 模板占位符
        # - {result} / {{result}}：子进程 stdout
        # - {exit_code}, {action}, {keyword}
        result_str = stdout_text[-200000:] if stdout_text else ""
        prompt_text = template
        for ph in ("{result}", "{{result}}"):
            prompt_text = prompt_text.replace(ph, result_str)
        prompt_text = prompt_text.replace("{exit_code}", "" if exit_code is None else str(exit_code))
        prompt_text = prompt_text.replace("{action}", action)
        prompt_text = prompt_text.replace("{keyword}", "" if keyword is None else str(keyword))

        agent_type = (script_cfg.get("agent_type") or "qwen").strip().lower()
        to_memos = bool(script_cfg.get("to_memos", False))
        analysis_text: str | None = None

        # 选择不同的模型/Agent 类型
        if agent_type == "qwen":
            qwen_key = os.getenv("QWEN_API_KEY", "").strip()
            if not qwen_key:
                await runtime.log_queue.put(
                    f"[{self._now()}] PROMAT found but QWEN_API_KEY missing; skip analysis."
                )
                return

            qwen_model = os.getenv("QWEN_DEFAULT_MODEL", "qwen-plus").strip()
            qwen_base = os.getenv(
                "QWEN_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"
            ).rstrip("/")
            url = f"{qwen_base}/chat/completions"
            payload = {
                "model": qwen_model,
                "messages": [
                    {"role": "system", "content": "你是一个严谨的分析助手。输出尽量结构化。"},
                    {"role": "user", "content": prompt_text},
                ],
                "stream": False,
            }

            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as client:
                    resp = await client.post(
                        url,
                        json=payload,
                        headers={
                            "Authorization": f"Bearer {qwen_key}",
                            "Content-Type": "application/json",
                        },
                    )
                data = resp.json()
                choices = data.get("choices") or []
                if choices and isinstance(choices, list):
                    msg = (choices[0] or {}).get("message") or {}
                    analysis_text = msg.get("content")
                if not analysis_text:
                    analysis_text = json.dumps(data, ensure_ascii=False)
            except Exception as exc:  # noqa: BLE001
                await runtime.log_queue.put(
                    f"[{self._now()}] PROMAT analyze(qwen) failed: {type(exc).__name__}: {exc!r}"
                )
                return

        elif agent_type == "gemini":
            gemini_key = (
                os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or ""
            ).strip()
            if not gemini_key:
                await runtime.log_queue.put(
                    f"[{self._now()}] PROMAT found but GEMINI_API_KEY missing; skip analysis."
                )
                return

            gemini_model = os.getenv("GEMINI_CHAT_MODEL", "gemini-2.0-flash").strip()
            url = (
                "https://generativelanguage.googleapis.com/v1beta"
                f"/models/{gemini_model}:generateContent"
            )
            payload = {
                "systemInstruction": {"parts": [{"text": "你是一个严谨的分析助手。输出尽量结构化。"}]},
                "contents": [{"role": "user", "parts": [{"text": prompt_text}]}],
            }
            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as client:
                    resp = await client.post(url, params={"key": gemini_key}, json=payload)
                data = resp.json()
                candidates = data.get("candidates") or []
                parts = (((candidates[0] or {}).get("content") or {}).get("parts") or [])
                texts: list[str] = []
                if isinstance(parts, list):
                    for p in parts:
                        if isinstance(p, dict) and "text" in p:
                            texts.append(str(p["text"]))
                analysis_text = "".join(texts).strip() or json.dumps(data, ensure_ascii=False)
            except Exception as exc:  # noqa: BLE001
                await runtime.log_queue.put(
                    f"[{self._now()}] PROMAT analyze(gemini) failed: {type(exc).__name__}: {exc!r}"
                )
                return

        else:
            await runtime.log_queue.put(
                f"[{self._now()}] PROMAT analysis unknown agent_type='{agent_type}', skip."
            )
            return

        runtime.last_callback_time = self._now()
        runtime.last_callback_result = {
            "promat_file": str(promat_path),
            "analysis": analysis_text,
            "exit_code": exit_code,
            "action": action,
            "keyword": keyword,
            "agent_type": agent_type,
            "archived_to_memos": to_memos,
        }
        await runtime.log_queue.put(f"[{self._now()}] PROMAT analysis done: {promat_path.name}")

        # 根据 to_memos 决定是否归档到 Memos（直接调用 Memos API）
        if to_memos:
            try:
                memo_visibility = os.getenv("MEMOS_DEFAULT_VISIBILITY", "PRIVATE").strip() or "PRIVATE"
                memo_resp = await self._create_memo(
                    content=analysis_text or "",
                    visibility=memo_visibility,
                )
                # 不覆盖 analysis 内容，只补充归档产物
                runtime.last_callback_result["memos"] = memo_resp
                await runtime.log_queue.put(
                    f"[{self._now()}] PROMAT memo archived: visibility={memo_visibility}"
                )
            except Exception as exc:  # noqa: BLE001
                await runtime.log_queue.put(
                    f"[{self._now()}] PROMAT memo archive failed: {type(exc).__name__}: {exc!r}"
                )

    def _memos_access_token(self) -> str:
        return (os.getenv("MEMOS_ACCESS_TOKEN") or os.getenv("MEMOS_ACCSEE_TOKEN") or "").strip()

    def _memos_api_url(self) -> str:
        # 优先使用完整创建 memo API
        if os.getenv("MEMOS_API_URL"):
            v = os.getenv("MEMOS_API_URL", "").strip().rstrip("/")
            # 容错：允许用户只填 base url，例如 http://host:port
            if v.endswith("/api/v1/memos"):
                return v
            if v:
                return f"{v}/api/v1/memos"
            return ""
        base = os.getenv("MEMOS_BASE_URL", "").strip().rstrip("/")
        if base:
            return f"{base}/api/v1/memos"
        return ""

    async def _create_memo(self, *, content: str, visibility: str = "PRIVATE") -> Any:
        token = self._memos_access_token()
        if not token:
            raise RuntimeError("Missing MEMOS token: set MEMOS_ACCESS_TOKEN (or MEMOS_ACCSEE_TOKEN) in .env")

        api_url = self._memos_api_url()
        if not api_url:
            raise RuntimeError(
                "Missing MEMOS_API_URL (or MEMOS_BASE_URL) in .env. "
                "Example: MEMOS_API_URL=http://<host>:<port>/api/v1/memos"
            )

        payload = {"content": content, "visibility": visibility}
        headers = {"Authorization": f"Bearer {token}"}

        # 给远端 API 设置更短的超时：避免“等待很久才 500”
        timeout = httpx.Timeout(connect=8.0, read=12.0, write=12.0, pool=5.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                resp = await client.post(api_url, json=payload, headers=headers)
            except httpx.TimeoutException as exc:
                raise RuntimeError(f"Memos API request timeout url={api_url!r}: {exc!r}") from exc
            except httpx.RequestError as exc:
                raise RuntimeError(f"Memos API request error url={api_url!r}: {exc!r}") from exc

        # Memos 通常返回 JSON；兜底把文本返回
        try:
            data = resp.json()
        except Exception:
            data = resp.text

        if resp.status_code >= 400:
            raise RuntimeError(
                f"Memos API failed url={api_url!r} status={resp.status_code}, body={data!r}"
            )

        return data

    async def sync_memos(self, script_id: str, *, content: str, visibility: str = "PRIVATE") -> dict[str, Any]:
        if script_id not in self._runtime:
            raise KeyError(f"Script '{script_id}' not found")
        runtime = self._runtime[script_id]
        try:
            memo = await self._create_memo(content=content, visibility=visibility)
        except Exception as exc:  # noqa: BLE001
            # 把失败原因写入 Drawer 实时日志，便于定位“500 但不知道为什么”
            await runtime.log_queue.put(
                f"[{self._now()}] Memo sync failed: {type(exc).__name__}: {exc!r}"
            )
            raise
        runtime.last_callback_time = self._now()
        runtime.last_callback_result = {
            "memos": memo,
            "content": content,
            "visibility": visibility,
        }
        # 日志里写入返回结构摘要，便于定位“成功但列表找不到”的问题
        memo_name = None
        if isinstance(memo, dict):
            memo_name = memo.get("name") or memo.get("uid") or memo.get("id") or memo.get("title")
        await runtime.log_queue.put(
            f"[{self._now()}] Memo created: visibility={visibility}, memo={memo_name or str(memo)[:500]}"
        )
        return memo

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
            cmd = tokens
            # 某些脚本的 argparse 不接受 --action / --keyword
            if bool(script_cfg.get("pass_action", True)):
                cmd += ["--action", action]
                if keyword:
                    cmd.extend(["--keyword", keyword])
            return cmd, run_cwd

        # 兼容旧配置：script_path 直接写脚本文件路径
        script_path = Path(script_path_raw)
        if not script_path.is_absolute():
            script_path = self.root_dir / script_path
        cmd = [python_executable, str(script_path)]
        if bool(script_cfg.get("pass_action", True)):
            cmd += ["--action", action]
            if keyword:
                cmd.extend(["--keyword", keyword])
        return cmd, run_cwd

    @staticmethod
    def _now() -> str:
        return dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
