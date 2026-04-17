from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
import os
import sys
from typing import Any

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .scheduler import ScriptScheduler
from .upstream_proxy import router as upstream_router
from .cdp_control import kill_and_start_chrome
from .data_views_service import (
    DataViewsBrowseStore,
    build_view_stat,
    get_data_view_posts,
    list_data_view_stats,
)

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_VIEWS_BROWSE_PATH = ROOT_DIR / "manager" / "state" / "data_views_browse.json"
WEB_DIR = Path(__file__).resolve().parent / "web"

# 根据运行环境选择不同配置：优先显式 RUN_ENV，其次按平台推断。
_RUN_ENV = os.getenv("RUN_ENV", "").strip().lower()
if _RUN_ENV == "mac" or (_RUN_ENV == "" and sys.platform == "darwin"):
    CONFIG_PATH = ROOT_DIR / "config-mac.yaml"
elif _RUN_ENV == "win" or (_RUN_ENV == "" and os.name == "nt"):
    CONFIG_PATH = ROOT_DIR / "confi-win.yaml"
else:
    CONFIG_PATH = ROOT_DIR / "config.yaml"

# 加载本地 .env（避免运行时缺少 QWEN_API_KEY / GEMINI_API_KEY）
def _load_local_env() -> None:
    env_path = ROOT_DIR / ".env"
    if not env_path.exists():
        return
    try:
        text = env_path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        key = k.strip()
        val = v.strip().strip("\"'").strip()
        if not key:
            continue
        # 注意：这里不要 setdefault，因为开发过程中 env 可能会修改，
        # 需要让 reload 后能读到最新值。
        os.environ[key] = val


_load_local_env()

# Windows 下 SelectorEventLoop 不支持 asyncio subprocess，需切换 Proactor。
if sys.platform.startswith("win"):
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())


def _normalize_config(cfg: dict[str, Any]) -> dict[str, Any]:
    # 兼容两种结构：
    # 1) 旧版: scripts: [...]
    # 2) 新版: projects: [{ id, script_path, venv_path, scripts: [...] }]
    if "scripts" in cfg:
        merged = dict(cfg)
        merged.setdefault("cdp_profiles", merged.get("cdp_profiles") or [])
        merged.setdefault("data_views", merged.get("data_views") or [])
        return merged

    normalized: list[dict[str, Any]] = []
    for project in cfg.get("projects", []):
        project_id = project.get("id", "project")
        project_name = project.get("name", project_id)
        project_path = project.get("script_path", ".")
        project_venv = project.get("venv_path")
        for item in project.get("scripts", []):
            item_id = item.get("id")
            if not item_id:
                continue
            normalized.append(
                {
                    "id": f"{project_id}-{item_id}",
                    "project_id": project_id,
                    "script_key": item_id,
                    "name": item.get("name", f"{project_name} / {item_id}"),
                    "icon": item.get("icon", "📄"),
                    "script_path": item.get("script_path", project_path),
                    "venv_path": item.get("venv_path", project_venv),
                    "run": item.get("run"),
                    "use_agent": item.get("use_agent", False),
                    "agent_type": item.get("agent_type"),
                    # 某些脚本依赖 Chrome DevTools Protocol（调试端口 9222）
                    # 需要在启动脚本前先连通端口再执行子进程。
                    "cdp": item.get("cdp", False),
                    # 可选：按脚本覆盖 CDP 地址（多 Chrome 实例时一人一端口）
                    "cdp_host": item.get("cdp_host"),
                    "cdp_port": item.get("cdp_port"),
                    # 某些脚本的 argparse 不接受 --action/--keyword 参数；
                    # 默认保持兼容：仍会传 --action {action}。
                    "pass_action": item.get("pass_action", True),
                    "to_memos": item.get("to_memos", False),
                    "schedule": item.get("schedule", {}),
                }
            )
    return {
        "scripts": normalized,
        "cdp_profiles": list(cfg.get("cdp_profiles") or []),
        "data_views": list(cfg.get("data_views") or []),
    }


def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        return {"scripts": [], "cdp_profiles": [], "data_views": []}
    with CONFIG_PATH.open("r", encoding="utf-8") as file:
        cfg = yaml.safe_load(file) or {}
    return _normalize_config(cfg)


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = ScriptScheduler(load_config(), ROOT_DIR)
    await scheduler.start_periodic_jobs()
    app.state.scheduler = scheduler
    app.state.data_views_browse = DataViewsBrowseStore(DATA_VIEWS_BROWSE_PATH)
    try:
        yield
    finally:
        await scheduler.shutdown()


app = FastAPI(title="Script Matrix Manager", lifespan=lifespan)
app.include_router(upstream_router)
app.mount("/web", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
app.mount("/assets", StaticFiles(directory=str(WEB_DIR / "assets")), name="assets")


class SearchPayload(BaseModel):
    keyword: str


class SyncPayload(BaseModel):
    content: str
    visibility: str = "PRIVATE"


class CallbackPayload(BaseModel):
    result: Any


class LogPayload(BaseModel):
    message: str
    level: str = "INFO"
    source: str = "callback"


class CdpRestartPayload(BaseModel):
    profile_id: str


class DataViewBrowsedPayload(BaseModel):
    """mark_all_seen=True 时把已浏览同步为当前文件总条数；否则用 browsed_count 覆盖。"""

    browsed_count: int | None = None
    mark_all_seen: bool = False


@app.get("/")
async def root():
    index_file = WEB_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {"message": "Web build not found. Put Vue build into manager/web."}


@app.get("/api/scripts")
async def list_scripts():
    return {"items": app.state.scheduler.list_cards()}


@app.get("/api/cdp/profiles")
async def list_cdp_profiles():
    # 每次从磁盘读取：run.py 可能复用已启动的旧 uvicorn，内存里的 scheduler.config 不会自动更新
    cfg = load_config()
    return {"items": list(cfg.get("cdp_profiles") or [])}


@app.get("/api/data-views")
async def list_data_views():
    views: list[dict[str, Any]] = list(app.state.scheduler.config.get("data_views") or [])
    store: DataViewsBrowseStore = app.state.data_views_browse

    def _run() -> list[dict[str, Any]]:
        return list_data_view_stats(views, root_dir=ROOT_DIR, browse_store=store)

    items = await asyncio.to_thread(_run)
    return {"items": items}


@app.get("/api/data-views/{view_id}/posts")
async def data_view_posts(view_id: str, limit: int = 200, offset: int = 0):
    views: list[dict[str, Any]] = list(app.state.scheduler.config.get("data_views") or [])
    found = next((v for v in views if str(v.get("id")) == view_id), None)
    if not found:
        raise HTTPException(status_code=404, detail=f"data view '{view_id}' not found")

    def _run() -> dict[str, Any]:
        return get_data_view_posts(
            found,
            root_dir=ROOT_DIR,
            limit=limit,
            offset=offset,
        )

    try:
        return await asyncio.to_thread(_run)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/data-views/{view_id}/browsed")
async def set_data_view_browsed(view_id: str, payload: DataViewBrowsedPayload):
    views: list[dict[str, Any]] = list(app.state.scheduler.config.get("data_views") or [])
    found = next((v for v in views if str(v.get("id")) == view_id), None)
    if not found:
        raise HTTPException(status_code=404, detail=f"data view '{view_id}' not found")

    store: DataViewsBrowseStore = app.state.data_views_browse

    def _apply() -> dict[str, Any]:
        if payload.mark_all_seen:
            stat = build_view_stat(found, root_dir=ROOT_DIR, browse_store=store)
            store.set_browsed(view_id, stat["record_count"])
            return build_view_stat(found, root_dir=ROOT_DIR, browse_store=store)
        if payload.browsed_count is not None:
            store.set_browsed(view_id, payload.browsed_count)
            return build_view_stat(found, root_dir=ROOT_DIR, browse_store=store)
        raise ValueError("请传 browsed_count 或 mark_all_seen=true")

    try:
        item = await asyncio.to_thread(_apply)
        return {"ok": True, "item": item}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/cdp/restart")
async def cdp_restart(payload: CdpRestartPayload):
    cfg = load_config()
    profiles: list[dict[str, Any]] = list(cfg.get("cdp_profiles") or [])
    prof = next((p for p in profiles if str(p.get("id")) == payload.profile_id), None)
    if not prof:
        raise HTTPException(status_code=404, detail=f"CDP profile '{payload.profile_id}' not found")

    def _run() -> dict[str, Any]:
        return kill_and_start_chrome(prof)

    try:
        result = await asyncio.to_thread(_run)
        return {"ok": True, **result}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/scripts/{script_id}/fetch")
async def run_fetch(script_id: str):
    try:
        await app.state.scheduler.trigger(script_id, action="fetch")
        return {"ok": True}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/scripts/{script_id}/search")
async def run_search(script_id: str, payload: SearchPayload):
    try:
        await app.state.scheduler.trigger(script_id, action="search", keyword=payload.keyword)
        return {"ok": True}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/scripts/{script_id}/stop")
async def stop_script(script_id: str):
    try:
        data = await app.state.scheduler.stop(script_id)
        return {"ok": True, "item": data}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/scripts/{script_id}/clear-logs")
async def clear_logs(script_id: str):
    try:
        data = await app.state.scheduler.clear_logs(script_id)
        return {"ok": True, "item": data}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/scripts/{script_id}/sync-memos")
async def sync_memos(script_id: str, payload: SyncPayload):
    try:
        memo = await app.state.scheduler.sync_memos(
            script_id,
            content=payload.content,
            visibility=payload.visibility,
        )
        return {"ok": True, "memo": memo}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        # 把真实错误透出，前端才能知道“成功了但没写入”的原因
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/scripts/{script_id}/callback")
async def callback_result(script_id: str, payload: CallbackPayload):
    try:
        data = app.state.scheduler.set_callback_result(script_id, payload.result)
        return {"ok": True, "item": data}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/scripts/{script_id}/result")
async def get_result(script_id: str):
    try:
        data = app.state.scheduler.get_callback_result(script_id)
        return {"ok": True, "item": data}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/scripts/{script_id}/log")
async def callback_log(script_id: str, payload: LogPayload):
    try:
        data = await app.state.scheduler.push_callback_log(
            script_id=script_id,
            message=payload.message,
            level=payload.level,
            source=payload.source,
        )
        return {"ok": True, **data}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/scripts/{script_id}/log-history")
async def callback_log_history(script_id: str, limit: int = 50):
    try:
        data = app.state.scheduler.get_callback_logs(script_id, limit=limit)
        return {"ok": True, **data}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/scripts/{script_id}/logs")
async def script_logs(script_id: str):
    scheduler = app.state.scheduler

    async def event_stream():
        try:
            async for line in scheduler.stream_logs(script_id):
                yield f"data: {line}\n\n"
        except KeyError:
            yield "event: error\ndata: script not found\n\n"

    # SSE：浏览器 EventSource 与反向代理下需禁用缓存/缓冲，否则“实时”观感会变差
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
