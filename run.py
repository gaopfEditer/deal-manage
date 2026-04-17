from __future__ import annotations

import atexit
import os
import importlib.util
import shutil
import signal
import subprocess
import sys
import time
import webbrowser
import json
import threading
import socket
import argparse
from pathlib import Path
from typing import Any
from urllib import request, error

try:
    import yaml  # type: ignore
except Exception:  # noqa: BLE001
    yaml = None

try:
    from manager.cdp_control import kill_and_start_chrome
except Exception:  # noqa: BLE001
    kill_and_start_chrome = None  # type: ignore[assignment,misc]


ROOT_DIR = Path(__file__).resolve().parent
WEB_DIR = ROOT_DIR / "web-console"
FRONTEND_URL = "http://localhost:5173"
BACKEND_URL = "http://127.0.0.1:8000"
CONFIG_PATH = ROOT_DIR / "config.yaml"
ENV_PATH = ROOT_DIR / ".env"
BACKEND_READY_POLL_SECONDS = 3.0
SCRIPT_STATUS_POLL_SECONDS = 3.0
DEFAULT_BACKEND_HOST = "127.0.0.1"
DEFAULT_BACKEND_PORT = 8000


def _spawn(cmd: list[str], cwd: Path) -> subprocess.Popen:
    kwargs: dict[str, object] = {"cwd": str(cwd)}
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["preexec_fn"] = os.setsid
    return subprocess.Popen(cmd, **kwargs)


def _stop_process(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            proc.send_signal(signal.CTRL_BREAK_EVENT)
            proc.wait(timeout=5)
        else:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=5)
    except Exception:
        pass
    if proc.poll() is None:
        try:
            if os.name == "nt":
                proc.kill()
            else:
                os.killpg(proc.pid, signal.SIGKILL)
        except Exception:
            pass


def _frontend_command() -> list[str]:
    if os.name == "nt":
        # Windows 下 pnpm/npm 通常是 *.cmd，走 cmd /c 更稳
        if shutil.which("pnpm") or shutil.which("pnpm.cmd"):
            return ["cmd", "/c", "pnpm", "dev"]
        if shutil.which("npm") or shutil.which("npm.cmd"):
            return ["cmd", "/c", "npm", "run", "dev"]
    else:
        if shutil.which("pnpm"):
            return ["pnpm", "dev"]
        if shutil.which("npm"):
            return ["npm", "run", "dev"]
    raise RuntimeError("Neither pnpm nor npm is installed. Please install one first.")


def _backend_command() -> list[str]:
    # 优先当前解释器，保证与当前环境一致
    if importlib.util.find_spec("uvicorn") is not None:
        return [
            sys.executable,
            "-m",
            "uvicorn",
            "manager.main:app",
            "--reload",
            "--no-access-log",
        ]
    # 回退：PATH 里的 uvicorn
    if os.name == "nt":
        if shutil.which("uvicorn") or shutil.which("uvicorn.exe"):
            return ["uvicorn", "manager.main:app", "--reload", "--no-access-log"]
    else:
        if shutil.which("uvicorn"):
            return ["uvicorn", "manager.main:app", "--reload", "--no-access-log"]
    raise RuntimeError(
        "uvicorn not found. Please install it in current environment: pip install uvicorn"
    )


def _load_dotenv(env_path: Path) -> None:
    if not env_path.exists():
        return
    try:
        text = env_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        key = k.strip()
        if not key:
            continue
        val = v.strip().strip("\"'")
        os.environ[key] = val


def _is_true(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _post_json(url: str, payload: dict[str, object] | None = None, timeout: float = 12.0) -> dict:
    body = b""
    headers = {}
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = request.Request(url=url, method="POST", data=body, headers=headers)
    with request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    return json.loads(raw) if raw else {}


def _get_json(url: str, timeout: float = 12.0) -> dict:
    req = request.Request(url=url, method="GET")
    with request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    return json.loads(raw) if raw else {}


def _wait_backend_ready(timeout_seconds: float = 60.0) -> bool:
    deadline = time.time() + timeout_seconds
    url = f"{BACKEND_URL}/api/scripts"
    while time.time() < deadline:
        try:
            req = request.Request(url=url, method="GET")
            with request.urlopen(req, timeout=3.0):
                return True
        except Exception:
            time.sleep(BACKEND_READY_POLL_SECONDS)
    return False


def _backend_api_alive(timeout: float = 1.5) -> bool:
    try:
        req = request.Request(url=f"{BACKEND_URL}/api/scripts", method="GET")
        with request.urlopen(req, timeout=timeout):
            return True
    except Exception:
        return False


def _choose_frontend_port(start_port: int = 5173) -> int:
    port = int(start_port)
    while _tcp_port_open("127.0.0.1", port):
        port += 1
    return port


def _frontend_url(port: int) -> str:
    return f"http://localhost:{int(port)}"


def _wait_script_finished(script_id: str, stop_event: threading.Event, timeout_seconds: float = 1800.0) -> bool:
    deadline = time.time() + timeout_seconds
    while not stop_event.is_set() and time.time() < deadline:
        try:
            data = _get_json(f"{BACKEND_URL}/api/scripts")
            items = data.get("items") or []
            target = next((it for it in items if str(it.get("id")) == script_id), None)
            if target is None:
                print(f"[CDP Runtime] script not found while waiting: {script_id}")
                return False
            status = str(target.get("status") or "")
            # running 结束后（online/error）才继续下一个
            if status != "running":
                return True
        except Exception as exc:  # noqa: BLE001
            print(f"[CDP Runtime] wait status failed {script_id}: {exc}")
        stop_event.wait(SCRIPT_STATUS_POLL_SECONDS)
    return False


def _tcp_port_open(host: str, port: int, timeout: float = 1.5) -> bool:
    try:
        with socket.create_connection((host, int(port)), timeout=timeout):
            return True
    except OSError:
        return False


def _parse_cdp_profiles_fallback(text: str) -> list[dict[str, Any]]:
    """无 PyYAML 时从 config.yaml 粗略解析 cdp_profiles 列表（与本项目缩进风格一致）。"""
    profiles: list[dict[str, Any]] = []
    lines = text.splitlines()
    start: int | None = None
    for i, line in enumerate(lines):
        if line.strip().startswith("cdp_profiles:"):
            start = i + 1
            break
    if start is None:
        return []
    current: dict[str, Any] | None = None
    in_keys = False
    i = start
    while i < len(lines):
        raw = lines[i]
        if not raw.strip() or raw.strip().startswith("#"):
            i += 1
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        if indent == 0 and not raw.strip().startswith("cdp_profiles"):
            break
        stripped = raw.strip()
        if in_keys:
            if indent <= 4 and not stripped.startswith("- "):
                in_keys = False
            else:
                i += 1
                continue
        if stripped.startswith("- "):
            if current is not None:
                profiles.append(current)
            rest = stripped[2:].strip()
            if rest.startswith("id:"):
                current = {"id": rest.split(":", 1)[1].strip().strip("'\"")}
            else:
                current = {}
        elif current is not None and ":" in stripped:
            if stripped.startswith("keys:") or stripped.startswith("keys :"):
                in_keys = True
                i += 1
                continue
            k, v = stripped.split(":", 1)
            key = k.strip()
            val = v.strip().strip("'\"")
            if key == "remote_debugging_port":
                try:
                    current[key] = int(val)
                except ValueError:
                    current[key] = val
            elif key == "after_port_kill_killall_chrome":
                current[key] = val.lower() in ("true", "1", "yes")
            elif key == "extra_args":
                pass
            else:
                current[key] = val
        i += 1
    if current is not None:
        profiles.append(current)
    return profiles


def _load_cdp_profiles_list() -> list[dict[str, Any]]:
    try:
        text = CONFIG_PATH.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        print(f"[CDP Runtime] read {CONFIG_PATH} failed: {exc}")
        return []
    if yaml is not None:
        try:
            cfg = yaml.safe_load(text) or {}
            return list(cfg.get("cdp_profiles") or [])
        except Exception as exc:  # noqa: BLE001
            print(f"[CDP Runtime] yaml parse failed, fallback parser: {exc}")
    return _parse_cdp_profiles_fallback(text)


def _find_local_cdp_profile(profile_id: str) -> dict[str, Any] | None:
    for p in _load_cdp_profiles_list():
        if str(p.get("id")) == profile_id:
            return dict(p)
    return None


def _start_cdp_runtime(stop_event: threading.Event, no_bootstrap: bool = False) -> threading.Thread:
    def _read_runtime_cfg_with_fallback() -> dict[str, object]:
        # 优先 PyYAML；若环境无 yaml 包，则用简易文本解析（仅支持本项目 cdp_runtime 结构）
        try:
            text = CONFIG_PATH.read_text(encoding="utf-8", errors="replace")
        except Exception as exc:  # noqa: BLE001
            print(f"[CDP Runtime] load config failed: {exc}")
            return {}

        if yaml is not None:
            try:
                cfg = yaml.safe_load(text) or {}
                return dict(cfg.get("cdp_runtime") or {})
            except Exception as exc:  # noqa: BLE001
                print(f"[CDP Runtime] yaml parse failed, fallback parser: {exc}")

        runtime: dict[str, object] = {}
        in_block = False
        scripts: list[str] = []
        in_scripts = False
        for raw in text.splitlines():
            line = raw.rstrip()
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            if stripped.startswith("cdp_runtime:"):
                in_block = True
                in_scripts = False
                continue
            if not in_block:
                continue
            if len(line) - len(line.lstrip(" ")) == 0:
                break
            if stripped.startswith("bootstrap_scripts:"):
                in_scripts = True
                continue
            if in_scripts and stripped.startswith("- "):
                scripts.append(stripped[2:].strip().strip("'\""))
                continue
            if in_scripts and not stripped.startswith("- "):
                in_scripts = False
            if ":" in stripped:
                k, v = stripped.split(":", 1)
                key = k.strip()
                val = v.strip().strip("'\"")
                if key:
                    runtime[key] = val
        if scripts:
            runtime["bootstrap_scripts"] = scripts
        return runtime

    def worker() -> None:
        runtime_cfg = _read_runtime_cfg_with_fallback()
        profile_id = str(runtime_cfg.get("profile_id") or "chrome-debug-default").strip()
        interval_seconds = int(runtime_cfg.get("interval_seconds", 10))
        bootstrap_mode = str(runtime_cfg.get("bootstrap_mode") or "once").strip().lower()
        script_ids = [str(s).strip() for s in (runtime_cfg.get("bootstrap_scripts") or []) if str(s).strip()]

        # CDP：只读本地 config.yaml，用 remote_debugging_port 是否可连判断；不依赖后端 /api/cdp/profiles
        profile = _find_local_cdp_profile(profile_id)
        if profile is None:
            print(
                f"[CDP Runtime] profile not found in {CONFIG_PATH}: {profile_id!r} "
                f"(请检查 cdp_profiles[].id 与 cdp_runtime.profile_id 是否一致)"
            )
            return
        if kill_and_start_chrome is None:
            print("[CDP Runtime] 无法导入 kill_and_start_chrome，请从项目根目录运行并安装依赖。")
            return
        port_raw = profile.get("remote_debugging_port") or os.getenv("CDP_PORT") or 9222
        port = int(port_raw)
        host = (
            str(profile.get("host") or os.getenv("CDP_HOST") or "127.0.0.1").strip()
            or "127.0.0.1"
        )
        if _tcp_port_open(host, port):
            print(f"[CDP Runtime] 端口已监听 {host}:{port}，视为 CDP 已在运行，跳过启动 Chrome。")
        else:
            try:
                kill_and_start_chrome(profile)
                print(f"[CDP Runtime] 已启动 Chrome（profile={profile_id}，调试端口 {port}）。")
            except Exception as exc:  # noqa: BLE001
                print(f"[CDP Runtime] 启动 Chrome 失败: {exc}")
                return

        if no_bootstrap:
            print("[CDP Runtime] --no-bootstrap enabled, skip bootstrap_scripts.")
            return
        if not script_ids:
            print("[CDP Runtime] 未配置 bootstrap_scripts，跳过脚本编排。")
            return

        print("[CDP Runtime] waiting backend ready ...")
        if not _wait_backend_ready(timeout_seconds=90):
            print("[CDP Runtime] backend is not ready in time, skip.")
            return

        def _trigger_once_round() -> None:
            for sid in script_ids:
                if stop_event.is_set():
                    break
                try:
                    _post_json(f"{BACKEND_URL}/api/scripts/{sid}/fetch")
                    print(f"[CDP Runtime] triggered fetch: {sid}")
                    finished = _wait_script_finished(sid, stop_event=stop_event)
                    if not finished:
                        print(f"[CDP Runtime] wait finished timeout/stop: {sid}")
                except error.HTTPError as exc:
                    print(f"[CDP Runtime] trigger failed {sid}: HTTP {exc.code}")
                except Exception as exc:  # noqa: BLE001
                    print(f"[CDP Runtime] trigger failed {sid}: {exc}")

        if bootstrap_mode != "loop":
            print(f"[CDP Runtime] bootstrap mode=once, scripts={script_ids}")
            _trigger_once_round()
            print("[CDP Runtime] bootstrap once completed, follow script schedule afterwards.")
            return

        print(
            f"[CDP Runtime] bootstrap mode=loop, interval={interval_seconds}s, scripts={script_ids}"
        )
        while not stop_event.is_set():
            _trigger_once_round()
            stop_event.wait(max(1, interval_seconds))

    t = threading.Thread(target=worker, name="cdp-runtime", daemon=True)
    t.start()
    return t


def main() -> int:
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument(
        "--no-bootstrap",
        action="store_true",
        help="Skip auto triggering bootstrap_scripts in cdp_runtime.",
    )
    args = parser.parse_args()

    _load_dotenv(ENV_PATH)

    if not WEB_DIR.is_dir():
        print(f"web-console directory not found: {WEB_DIR}")
        return 1

    backend_cmd = _backend_command()
    frontend_port = _choose_frontend_port(5173)
    frontend_cmd = _frontend_command() + ["--port", str(frontend_port)]

    backend: subprocess.Popen | None = None
    if _backend_api_alive():
        print(f"Backend already running: {BACKEND_URL} (reuse existing process)")
    elif _tcp_port_open(DEFAULT_BACKEND_HOST, DEFAULT_BACKEND_PORT):
        print(
            f"Backend port {DEFAULT_BACKEND_HOST}:{DEFAULT_BACKEND_PORT} is occupied, "
            "skip backend spawn to avoid crash."
        )
    else:
        print(f"Starting backend: {' '.join(backend_cmd)}")
        backend = _spawn(backend_cmd, ROOT_DIR)
    print(f"Starting frontend: {' '.join(frontend_cmd)}")
    frontend = _spawn(frontend_cmd, WEB_DIR)
    stop_event = threading.Event()
    cdp_thread: threading.Thread | None = None
    if _is_true(os.getenv("IS_RUN_WITH_CDP")):
        cdp_thread = _start_cdp_runtime(stop_event, no_bootstrap=args.no_bootstrap)

    def cleanup() -> None:
        stop_event.set()
        if cdp_thread and cdp_thread.is_alive():
            cdp_thread.join(timeout=2)
        _stop_process(frontend)
        if backend is not None:
            _stop_process(backend)

    atexit.register(cleanup)

    try:
        # Wait briefly so dev server can boot, then open browser.
        time.sleep(2)
        front_url = _frontend_url(frontend_port)
        webbrowser.open(front_url)
        print(f"Opened browser: {front_url}")
        print("Press Ctrl+C to stop both services.")
        while True:
            if backend is not None and backend.poll() is not None:
                print(f"Backend exited with code {backend.returncode}")
                return backend.returncode or 0
            if frontend.poll() is not None:
                print(f"Frontend exited with code {frontend.returncode}")
                return frontend.returncode or 0
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\nStopping services...")
        return 0
    finally:
        cleanup()


if __name__ == "__main__":
    raise SystemExit(main())
