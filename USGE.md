# deal-manage

脚本执行和结果可视化系统（FastAPI + Vue3 + Element Plus）。

## 目录结构

- `manager/main.py`: FastAPI 入口，提供调度 API 和日志流 API，并托管静态页面
- `manager/scheduler.py`: 核心调度逻辑，负责 subprocess 执行和状态维护
- `manager/web/`: **Vite 构建产物**（`npm run build` 输出到此目录，由 FastAPI 托管）
- `web-console/`: **Vue 3 + Vite + Element Plus** 源码（开发时 `npm run dev`，接口通过 Vite 代理到后端）
- `config.yaml`: 支持项目级配置（一个项目下多个脚本任务）
- `scripts/*.py`: 示例脚本（便于本地联调）

## 后端依赖

```bash
pip install -r requirements.txt
```

### AI 接口（本仓库内实现，非转发）

直接调用 **Google Gemini**（Generative Language API）与 **通义千问**（DashScope OpenAI 兼容接口）。路径约定与常见网关类似：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/gemini/chat` | JSON：`role`、`message`；或 `multipart`：`role`、`message`、`files` |
| POST | `/gemini/image` | JSON：`prompt`，可选 `aspectRatio`、`referenceImages`（base64） |
| POST | `/qwen/chat` | JSON：`messages`、`model`、`stream` |

环境变量请参考项目根目录 **`.env.example`**，复制为 `.env` 后按需填写（可用 `python-dotenv` 或系统环境变量注入）。

### Telegram 推送（统一 Bot + 外部发信）

全项目共用一个 Bot Token，在 `config.yaml` 顶层配置 **`telegram`**（或环境变量 **`TELEGRAM_BOT_TOKEN`**）。群组在 `telegram.chats` 里登记别名与 `chat_id`；脚本任务用 `send_to_telegram: true` + `telegram_chat: <别名>` 即可。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/telegram/config` | 查看已登记群组、Token 是否已配置（掩码） |
| POST | `/api/telegram/send` | 向指定群组发送文本消息 |

**`POST /api/telegram/send` 请求体：**

- `chat_id`（必填）：数值群组 id，或 `config.yaml` 里 `telegram.chats[].id` 别名（如 `binance_square`）
- `text`（必填）：消息正文
- `parse_mode`（可选）：`HTML` / `Markdown` / `MarkdownV2`
- `disable_web_page_preview`（可选）：布尔

**示例：直接指定群组 id**

```bash
curl -s -X POST http://127.0.0.1:8000/api/telegram/send \
  -H 'Content-Type: application/json' \
  -d '{"chat_id":-5289237674,"text":"测试消息"}'
```

**示例：使用配置别名（与 `telegram.chats[].id` 一致）**

```bash
curl -s -X POST http://127.0.0.1:8000/api/telegram/send \
  -H 'Content-Type: application/json' \
  -d '{"chat_id":"binance_square","text":"测试消息"}'
```

**查看已登记群组：**

```bash
curl -s http://127.0.0.1:8000/api/telegram/config
```

成功时 `send` 接口返回 `{"ok":true,"chat_id":"...", ...}`；失败时 HTTP 4xx/5xx，`detail` 为错误说明。需先启动后端（`uvicorn` 或 `python run.py`）。

### 群内交易信号 → 润色 → 发布币安广场

将**群内原始交易信号**与 **`prompts/publish_manifest.yaml` 中的 style id**（及可选 strategy id）一并提交，由 Ollama 按模块聚合文案后发布到币安广场。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/publish/prompts` | 列出 `styles` / `strategies` / `router` 模块 id |
| POST | `/api/publish/signal` | 信号润色 + 发布（`publish: false` 时仅润色） |

**`style_ids` 可选值（叙事外壳）：** `style_tianya_classic`、`style_classical_history`、`style_trending_hotspot`

**`strategy_id` 可选值（策略内核）：** `strategy_left_ambush`、`strategy_wide_sl`、`strategy_realtime_momentum`

**示例：指定风格 + 左侧埋伏策略，润色并发布**

```bash
curl -s -X POST http://127.0.0.1:8000/api/publish/signal \
  -H 'Content-Type: application/json' \
  -d '{
    "signal": "ETH 做空（25连胜） 仓位思路强平控制3000及以上\n2178市价直接空 100倍 2%保证金\n再挂2263（逃命点位只给一次机会逃）100倍 3%保证金\n第一芷楹2018（或者靠嘴喊芷楹） 芷楹70% 移动保本损\n第二芷楹1788\n第三芷楹1388\n芷損2300。#ETH",
    "style_ids": ["style_tianya_classic"],
    "strategy_id": "strategy_left_ambush",
    "compose_mode": "manual",
    "publish": true
  }'
```

**示例：多个风格候选，由 AI 自动择一并匹配策略**

```bash
curl -s -X POST http://127.0.0.1:8000/api/publish/signal \
  -H 'Content-Type: application/json' \
  -d '{
    "signal": "ETH 做空（25连胜） ...",
    "style_ids": ["style_tianya_classic", "style_classical_history"],
    "compose_mode": "auto",
    "publish": true
  }'
```

**仅预览润色、不发布：** 请求体加 `"publish": false`，响应含 `polished.content` 与 `prompt_selection`。

成功发布时响应含 `publish_item.post_url`（币安广场帖子链接）。需配置 `BINANCE_SQUARE_API_KEY` 或 `config.yaml` → `publish.platforms`。

## 前端（Vue 3 + Element Plus）

```bash
cd web-console
npm install
npm run build
```

开发时前后端分离：先启动 `uvicorn`，再在 `web-console` 下执行 `npm run dev`，页面走 Vite（`/api` 会代理到 `http://127.0.0.1:8000`）。

## 启动

```bash
source .venv/bin/activate
lsof -ti:8000 | xargs kill -9
uvicorn manager.main:app --reload
```

若已执行过 `npm run build`，访问 [http://127.0.0.1:8000/](http://127.0.0.1:8000/) 即为打包后的控制台。

## 配置示例（推荐）

```yaml
projects:
  - id: auto-deal-eth
    name: Auto Deal ETH
    script_path: 'D:\frontend\main\python\auto-deal-eth'
    venv_path: ".venv"
    scripts:
      - id: run-calendar
        run: "python -m getinfo.run_calendar"
        schedule:
          mode: interval
          seconds: 60
      - id: run-1
        run: "python -m getinfo.run_1"
        schedule:
          mode: once
          enabled: false
```

系统会自动将项目下每个 `scripts` 条目展开成一个独立任务卡片（ID 形如 `auto-deal-eth-run-calendar`）。



**以远程调试模式启动Chrome**：

**Windows:**
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222  --user-data-dir="D:\chrome_debug_profile"
```

**Mac:**
```bash

lsof -ti:8000 | xargs kill -9

/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

【main】f17681831400@gmail.com 
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir="/Users/maotouying/frontend/chrome-debug"

另外两个124、176可以用的 

// g17681831401@163.com pl1086 海外技术 1245@qq.com1
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
--remote-debugging-port=9223 \
--user-data-dir="/Users/maotouying/frontend/chrome-debug-9223" \
--no-first-run \
--no-default-browser-check \
--disable-component-update \
--disable-sync \
--disable-extensions \
--disable-background-networking \
--disable-background-timer-throttling \
--disable-client-side-phishing-detection \
--disable-default-apps \
--disable-gpu-shader-disk-cache \
--disable-software-rasterizer \
--disk-cache-size=10485760 \
--media-cache-size=10485760 \
--password-store=basic

// g17681831402@163.com gpg1086 see/推送
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
--remote-debugging-port=9224 \
--user-data-dir="/Users/maotouying/frontend/chrome-debug-9224" \
--no-first-run \
--no-default-browser-check \
--disable-component-update \
--disable-sync \
--disable-extensions \
--disable-background-networking \
--disable-background-timer-throttling \
--disable-client-side-phishing-detection \
--disable-default-apps \
--disable-gpu-shader-disk-cache \
--disable-software-rasterizer \
--disk-cache-size=10485760 \
--media-cache-size=10485760 \
--password-store=basic
```

// 自动启动前后端，和默认启动一次抓取
python run.py
python run.py --no-bootstrap