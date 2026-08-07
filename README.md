# deal-manage

面向运营与自动化脚本的 **任务调度 + Web 控制台 + 数据视图 + 可选视频导出** 的一体化仓库：用 YAML 声明多项目下的 Python 任务，由后端拉起子进程、写日志、按计划执行，前端负责监控与触发辅助流程。

---

## 主要功能

### 1. 脚本任务调度（核心）

- 通过 **`config.yaml`**（或 `RUN_ENV` 对应的 `config-mac.yaml` / `confi-win.yaml`）配置 **项目 → 多条脚本**，每条包含启动命令、工作目录、虚拟环境、定时策略（间隔 / 单次等）。
- **`manager/scheduler.py`** 维护任务状态（运行中 / 成功 / 失败），支持 **启动、停止、手动再跑**，日志通过队列供前端 **SSE 流式** 查看。
- 支持 **`python run.py`** 一键拉起后端（`uvicorn`）与前端开发服务（`pnpm`/`npm dev`），并可选首次引导抓取；详见文末「快速启动」。

### 2. Web 控制台（Vue 3 + Element Plus）

- 源码在 **`web-console/`**，构建产物可输出到 **`manager/web/`**，由 FastAPI 托管静态资源。
- 任务卡片展示状态与日志；与 **CDP（Chrome 远程调试）**、**数据视图**、**Telegram 通知** 等能力在界面上联动（具体以 `App.vue` 与后端 API 为准）。

### 3. CDP / Chrome 远程调试

- 对标记需要 CDP 的脚本，可在启动前检测调试端口或调用 **`manager/cdp_control.py`** 等逻辑，便于依赖 **已登录浏览器会话** 的抓取类脚本（与 `run.py` 中的 CDP 说明一致）。

### 4. 数据视图（Data views）

- 配置中的 **`data_views`** 与脚本产出数据关联，用于在控制台中 **浏览、统计** 抓取结果（实现见 **`manager/data_views_service.py`** 及相关 API）。

### 5. Remotion：JSON 驱动短视频（子项目）

- 目录 **`remotion/`**：根据 **`public/*.json`** 工程描述（时间轴、图表层、文案等）生成 **竖屏类演示视频**，支持多 Composition 注册（见 **`remotion/src/projectRegistry.ts`**）。
- 与主系统的调度无强制绑定，可作为 **独立 `pnpm dev` / `pnpm render`** 的可视化导出工具使用。

---

## 服务维护清单

主进程入口：**`manager/main.py`**（`uvicorn` / `python run.py`）。下列能力挂在同一 FastAPI 进程内，不是多个独立 daemon。接口细节见 **`USGE.md`**。

### FastAPI 内常驻能力

| 服务 | 模块 | 主要路径 / 行为 | 配置 / 依赖 |
|------|------|-----------------|-------------|
| **脚本调度** | `scheduler.py` | `/api/scripts/*`：启停、抓取、搜索、日志 SSE、结果回调 | `config.yaml`（或 `RUN_ENV` 对应 YAML） |
| **Telegram 通知** | `telegram_router.py` / `telegram_service.py` | `/api/telegram/config`、`POST /api/telegram/send`；脚本跑完可自动推高星帖 | `telegram.bot_token` 或 `TELEGRAM_BOT_TOKEN`；`telegram.chats` 别名；脚本侧 `send_to_telegram` + `telegram_chat`。**无入站监听 / Webhook** |
| **Ollama 本地代理** | `local_ollama.py` | `POST /ollama/chat`、`POST /ollama/chat-image` → 本机 Ollama `/api/generate` | `ollama_local.yaml`（或 `OLLAMA_LOCAL_CONFIG`）；需本机 Ollama 已运行 |
| **上游 AI 代理** | `upstream_proxy.py` | `POST /gemini/chat`、`/gemini/image`、`/qwen/chat` | `.env` 中的 Gemini / Qwen 密钥 |
| **发布服务** | `publish_router.py` / `publish_service.py` | `/api/publish/*`：提示词、润色、信号发布、历史与附件 | `publish` 配置、`BINANCE_SQUARE_API_KEY` 等；润色走 Ollama |
| **任务服务** | `task_router.py` / `task_service.py` | `/api/tasks/*` CRUD、提醒查询；启动时跑 `task_reminder_loop` | 后端 `manager/state/tasks.json`；控制台当前可优先用前端 localStorage |
| **数据视图** | `data_views_service.py` | `/api/data-views`、帖子列表、已浏览标记 | `config.yaml` → `data_views` |
| **CDP / Chrome** | `cdp_control.py` | `/api/cdp/profiles`、`POST /api/cdp/restart` | `cdp_profiles`；脚本可标 `cdp: true` |
| **Web 控制台静态托管** | `manager/web/` | `/`、`/web`、`/assets` | 由 `web-console` 执行 `npm run build` 产出 |
| **Memos 同步** | 挂在脚本 API | `POST /api/scripts/{id}/sync-memos` | 脚本配置 `to_memos`（非独立对外服务） |
| **WhisprRT 转写** | `whisper_router.py` / `whisper_service.py` | `GET /api/whisper/config`、`POST /api/whisper/transcribe`：传 URL/标题，子进程跑 WhisprRT 脚本，返回 `subtitles`/`output`/`logs` 路径 | `config.yaml` → `whisper`，或 `WHISPRT_ROOT` / `WHISPRT_PYTHON`；依赖兄弟目录 `WhisprRT/batch_whisperx_nodownload.py` |

### 仓库内、非本 FastAPI 进程

| 组件 | 位置 | 说明 |
|------|------|------|
| **本机 Ollama** | 外部进程 | 默认 `http://localhost:11434`；本仓库只做 HTTP 代理 |
| **业务脚本** | `scripts/*.py` 及各项目 `script_path` | 由调度器按需拉起子进程，非常驻 HTTP |
| **WhisprRT** | 默认 `../WhisprRT` | faster-whisper 流转写 + Qwen 整理；由本仓库 API 按需拉起 |
| **Mac Studio 监控** | `macstudio/` | bash + launchd 采集/周月统计，与 Web 主服务分离 |
| **Remotion** | `remotion/` | 可选独立前端渲染工程 |

### 维护注意

- **扩路由**：在 `manager/main.py` 的 `app.include_router(...)` 注册；生命周期后台任务写在 `lifespan`（当前有调度周期任务 + 任务提醒循环）。
- **密钥**：Telegram / Gemini / Qwen / 发布平台等勿入库；用 `.env` 或本地 YAML，泄露后轮换。
- **配置切换**：`RUN_ENV=mac|win` 切换机器配置文件；Ollama 用 `OLLAMA_LOCAL_CONFIG`。
- **前后端**：日常开发可 `python run.py`；仅后端则 `uvicorn manager.main:app --reload`。生产静态页需先 `cd web-console && npm run build`。

---

## 技术栈概览

| 层级 | 技术 |
|------|------|
| 后端 | Python 3、FastAPI、Uvicorn、PyYAML、HTTPX |
| 前端 | Vue 3、Vite、Element Plus |
| 视频 | Remotion 4.x（React） |

依赖列表见 **`requirements.txt`**；前端依赖见 **`web-console/package.json`**、**`remotion/package.json`**。

---

## 快速启动与详细文档

```bash
pip install -r requirements.txt
python run.py
```

更完整的目录说明、环境变量、前后端分离开发方式、Chrome 调试参数示例等，见 **`USGE.md`**（文件名保持仓库现状）。

---

## 配置与安全建议

- **勿将 Bot Token、API Key 等密钥提交到 Git**。请使用 **`.env`** 或未跟踪的本地配置，并在泄露后 **轮换** Token。
- 多机或多 OS 时可用环境变量 **`RUN_ENV`**（如 `mac` / `win`）指向不同 YAML；逻辑见 **`manager/main.py`** 顶部配置选择。

---

## 仓库结构（精简）

```
deal-manage/
├── manager/           # FastAPI：调度、Telegram、Ollama、发布、任务、数据视图、CDP、静态托管
├── web-console/       # 控制台前端源码
├── remotion/          # JSON 驱动 Remotion 工程（可选）
├── macstudio/         # Mac 监控采集（与主 Web 服务分离）
├── run.py             # 本地一键启动脚本
├── config.yaml        # 主配置（项目 + 脚本 + telegram + publish + data_views 等）
├── ollama_local.yaml  # 本地 Ollama 代理配置
├── requirements.txt
├── USGE.md            # 使用说明与接口示例（详细）
└── README.md          # 本文件（含服务维护清单）
```

如有新同事接入，优先阅读 **本 README 了解能力边界与服务清单**，再按 **USGE.md** 搭环境与调接口。
