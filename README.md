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

### 5. Telegram 推送（非群监控）

- 任务完成后可按脚本配置 **`send_to_telegram`**、**`telegram_token`**、**`telegram_chat_id`** 向指定会话 **发送消息**（`sendMessage`）。
- **不包含** 监听 Telegram 群消息、Webhook 收消息等入站逻辑。

### 6. 内置 AI HTTP 接口（非简单转发网关形态）

- **`manager/main.py`** 挂载路由：例如 **Gemini**（`/gemini/chat`、`/gemini/image`）、**通义千问**（`/qwen/chat`）等；密钥通过 **`.env`** 注入（可参考仓库内 **`.env.example`**）。

### 7. Remotion：JSON 驱动短视频（子项目）

- 目录 **`remotion/`**：根据 **`public/*.json`** 工程描述（时间轴、图表层、文案等）生成 **竖屏类演示视频**，支持多 Composition 注册（见 **`remotion/src/projectRegistry.ts`**）。
- 与主系统的调度无强制绑定，可作为 **独立 `pnpm dev` / `pnpm render`** 的可视化导出工具使用。

### 8. 其他后端能力

- **上游代理 / 本地 Ollama** 等路由分模块挂载（`upstream_proxy`、`local_ollama`），便于扩展本地模型或统一出口。

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
├── manager/           # FastAPI 应用、调度器、静态托管、数据视图等
├── web-console/       # 控制台前端源码
├── remotion/          # JSON 驱动 Remotion 工程（可选）
├── run.py             # 本地一键启动脚本
├── config.yaml        # 主配置示例（项目 + 脚本 + data_views 等）
├── requirements.txt
├── USGE.md            # 使用说明（详细）
└── README.md          # 本文件
```

如有新同事接入，优先阅读 **本 README 了解能力边界**，再按 **USGE.md** 搭环境。
