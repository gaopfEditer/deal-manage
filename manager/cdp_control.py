"""按配置结束占用调试端口的进程并启动 Chrome（用于 CDP / Selenium 调试）。"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


def _kill_listeners_on_port(port: int) -> list[str]:
    logs: list[str] = []
    if os.name == "nt":
        ps = (
            f"$p = Get-NetTCPConnection -LocalPort {int(port)} -State Listen "
            "-ErrorAction SilentlyContinue | "
            "Select-Object -ExpandProperty OwningProcess -Unique; "
            "if ($p) { $p | ForEach-Object { "
            "Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }"
        )
        try:
            r = subprocess.run(
                ["powershell", "-NoProfile", "-Command", ps],
                capture_output=True,
                text=True,
                timeout=45,
            )
            logs.append(f"[win] kill port {port} powershell exit={r.returncode}")
            if r.stderr and r.stderr.strip():
                logs.append(f"[win] stderr: {r.stderr.strip()[:800]}")
        except Exception as exc:  # noqa: BLE001
            logs.append(f"[win] kill failed: {type(exc).__name__}: {exc!r}")
        return logs

    # macOS / Linux: 结束监听该 TCP 端口的进程
    r = subprocess.run(
        ["lsof", "-nP", "-iTCP", f"{int(port)}", "-sTCP:LISTEN", "-t"],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if r.returncode != 0 or not (r.stdout or "").strip():
        logs.append(f"[unix] no listener on port {port} (lsof exit={r.returncode})")
        return logs

    pids: list[int] = []
    for line in r.stdout.strip().splitlines():
        try:
            pids.append(int(line.strip()))
        except ValueError:
            continue
    for pid in sorted(set(pids)):
        try:
            os.kill(pid, signal.SIGTERM)
            logs.append(f"[unix] SIGTERM pid={pid}")
        except ProcessLookupError:
            logs.append(f"[unix] pid={pid} already gone")
        except PermissionError as exc:
            logs.append(f"[unix] SIGTERM pid={pid} permission: {exc!r}")

    time.sleep(0.4)

    r2 = subprocess.run(
        ["lsof", "-nP", "-iTCP", f"{int(port)}", "-sTCP:LISTEN", "-t"],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if r2.returncode == 0 and (r2.stdout or "").strip():
        for line in r2.stdout.strip().splitlines():
            try:
                pid = int(line.strip())
            except ValueError:
                continue
            try:
                os.kill(pid, signal.SIGKILL)
                logs.append(f"[unix] SIGKILL pid={pid}")
            except ProcessLookupError:
                pass
            except PermissionError as exc:
                logs.append(f"[unix] SIGKILL pid={pid} permission: {exc!r}")

    return logs


def _optional_killall_chrome_darwin() -> list[str]:
    if sys.platform != "darwin":
        return []
    try:
        r = subprocess.run(
            ["killall", "Google Chrome"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        return [f"[darwin] killall 'Google Chrome' exit={r.returncode}"]
    except Exception as exc:  # noqa: BLE001
        return [f"[darwin] killall failed: {type(exc).__name__}: {exc!r}"]


def kill_and_start_chrome(profile: dict[str, Any]) -> dict[str, Any]:
    """
    profile 字段：
    - id, name（展示用）
    - chrome_path: Chrome 可执行文件绝对路径
    - user_data_dir: 用户数据目录（账号隔离）
    - remote_debugging_port: 调试端口
    - extra_args: 可选，附加启动参数列表
    - after_port_kill_killall_chrome: 可选 bool，仅在 darwin 上再执行 killall（慎用）
    """
    logs: list[str] = []

    chrome_path = str(profile.get("chrome_path") or "").strip()
    if not chrome_path:
        raise ValueError("cdp_profiles[].chrome_path 不能为空")

    user_data_dir = os.path.expanduser(str(profile.get("user_data_dir") or "").strip())
    if not user_data_dir:
        raise ValueError("cdp_profiles[].user_data_dir 不能为空")

    port_raw = profile.get("remote_debugging_port")
    if port_raw is None or str(port_raw).strip() == "":
        raise ValueError("cdp_profiles[].remote_debugging_port 不能为空")
    port = int(port_raw)

    exe = Path(chrome_path)
    if not exe.is_file():
        raise FileNotFoundError(f"Chrome 可执行文件不存在: {exe}")

    Path(user_data_dir).mkdir(parents=True, exist_ok=True)

    logs.extend(_kill_listeners_on_port(port))

    if bool(profile.get("after_port_kill_killall_chrome", False)):
        logs.extend(_optional_killall_chrome_darwin())
        time.sleep(0.3)

    cmd: list[str] = [
        str(exe),
        f"--remote-debugging-port={port}",
        f"--user-data-dir={user_data_dir}",
    ]
    for a in profile.get("extra_args") or []:
        if str(a).strip():
            cmd.append(str(a))

    popen_kw: dict[str, Any] = {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
    }
    if os.name == "nt":
        # 新控制台进程，避免随父进程退出
        popen_kw["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        if hasattr(subprocess, "DETACHED_PROCESS"):
            popen_kw["creationflags"] |= subprocess.DETACHED_PROCESS  # type: ignore[attr-defined]
    else:
        popen_kw["start_new_session"] = True
        popen_kw["close_fds"] = True

    subprocess.Popen(cmd, **popen_kw)  # noqa: S603
    logs.append(f"Started Chrome: {' '.join(cmd)}")
    return {"logs": logs, "command": cmd}
