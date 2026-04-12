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
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir="/Users/mac/frontend/chrome-debug"

另外两个124、176可以用的 

// g17681831402@163.com see
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
--remote-debugging-port=9223 \
--user-data-dir="/Users/mac/frontend/chrome-debug-9223" \
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

// g17681831401@163.com 没想好
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
--remote-debugging-port=9224 \
--user-data-dir="/Users/mac/frontend/chrome-debug-9224" \
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