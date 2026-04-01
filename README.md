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
pip install fastapi uvicorn pyyaml
```

## 前端（Vue 3 + Element Plus）

```bash
cd web-console
npm install
npm run build
```

开发时前后端分离：先启动 `uvicorn`，再在 `web-console` 下执行 `npm run dev`，页面走 Vite（`/api` 会代理到 `http://127.0.0.1:8000`）。

## 启动

```bash
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