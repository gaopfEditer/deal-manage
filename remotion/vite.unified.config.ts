import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const STUDIO = "http://127.0.0.1:3008";

const marketProxy = {
  // 须写在 /binance 之前，或使用更精确前缀，避免 /binance-bapi 被 /binance 吃掉
  "/binance-bapi": {
    target: "https://www.binance.com",
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/binance-bapi/, ""),
    headers: {
      Origin: "https://www.binance.com",
      Referer: "https://www.binance.com/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
  },
  "/binance-fapi": {
    target: "https://fapi.binance.com",
    changeOrigin: true,
    timeout: 5_000,
    proxyTimeout: 5_000,
    rewrite: (p: string) => p.replace(/^\/binance-fapi/, ""),
  },
  "/bybit": {
    target: "https://api.bybit.com",
    changeOrigin: true,
    timeout: 10_000,
    proxyTimeout: 10_000,
    rewrite: (p: string) => p.replace(/^\/bybit/, ""),
  },
  // 仅匹配 /binance/…，勿用裸 /binance（会误伤 /binance-bapi）
  "^/binance/": {
    target: "https://data-api.binance.vision",
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/binance/, ""),
  },
  "/sina-cn": {
    target: "https://money.finance.sina.com.cn",
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/sina-cn/, ""),
    headers: { Referer: "https://finance.sina.com.cn" },
  },
  "/sina-us": {
    target: "https://stock.finance.sina.com.cn",
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/sina-us/, ""),
    headers: { Referer: "https://stock.finance.sina.com.cn" },
  },
  "/tencent": {
    target: "https://proxy.finance.qq.com",
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/tencent/, ""),
    headers: { Referer: "https://finance.qq.com" },
  },
  "/gate": {
    target: "https://api.gateio.ws",
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/gate/, ""),
  },
} as const;

const REMOTION_ROOT = path.resolve(__dirname);
const GATE_APP = path.join(REMOTION_ROOT, "operate-gate-app");
const GATE_HTML = path.join(GATE_APP, "index.html");
const GATE_MAIN = path.join(GATE_APP, "main.tsx");
const PNL_BG = path.join(REMOTION_ROOT, "pnl-cards/public/backgrounds");
const PNL_TPL = path.join(REMOTION_ROOT, "pnl-cards/templates");

/** /operate-gate/ 盈利图生成（独立于 operate-tools base） */
function operateGatePlugin(): Plugin {
  return {
    name: "operate-gate",
    config() {
      return {
        server: {
          fs: {
            allow: [GATE_APP, path.join(REMOTION_ROOT, "pnl-cards"), REMOTION_ROOT],
          },
        },
      };
    },
    resolveId(source) {
      if (source === "/operate-gate-app/main.tsx") return GATE_MAIN;
      return null;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];

        if (url.startsWith("/operate-gate/backgrounds/")) {
          const name = decodeURIComponent(url.slice("/operate-gate/backgrounds/".length));
          if (name && !name.includes("..")) {
            const file = path.join(PNL_BG, name);
            if (fs.existsSync(file)) {
              if (name.endsWith(".png")) res.setHeader("Content-Type", "image/png");
              fs.createReadStream(file).pipe(res);
              return;
            }
          }
        }

        if (url.startsWith("/operate-gate/templates/")) {
          const name = decodeURIComponent(url.slice("/operate-gate/templates/".length));
          if (name && !name.includes("..") && name.endsWith(".json")) {
            const file = path.join(PNL_TPL, name);
            if (fs.existsSync(file)) {
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              fs.createReadStream(file).pipe(res);
              return;
            }
          }
        }

        if (url === "/operate-gate" || url === "/operate-gate/") {
          void (async () => {
            try {
              let html = fs.readFileSync(GATE_HTML, "utf8");
              html = await server.transformIndexHtml("/operate-gate/", html);
              res.setHeader("Content-Type", "text/html; charset=utf-8");
              res.end(html);
            } catch (e) {
              next(e);
            }
          })();
          return;
        }

        next();
      });
    },
  };
}

function gatewayIndexPlugin(): Plugin {
  return {
    name: "gateway-index",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (url === "/" || url.startsWith("/?")) {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>deal-manage · :3007</title>
  <style>
    body{margin:0;font-family:"IBM Plex Sans","PingFang SC",sans-serif;background:#0d1117;color:#e6edf3;padding:48px 40px}
    a{color:#f0883e;font-size:18px;text-decoration:none}
    a:hover{text-decoration:underline}
    li{margin:12px 0}
    code{color:#8b949e}
  </style>
</head>
<body>
  <h1>Remotion · port 3007</h1>
  <ul>
    <li><a href="/operate-tools/">/operate-tools</a> — 运营工具台（全屏）</li>
    <li><a href="/operate-gate/">/operate-gate</a> — 盈利图生成（叠字出 PNG）</li>
    <li><a href="/json-eth-overview">/json-eth-overview</a> — ETH 视频工程（Studio）</li>
  </ul>
  <p><code>http://localhost:3007</code></p>
</body>
</html>`);
          return;
        }
        next();
      });
    },
  };
}

/** 统一网关：:3007 → operate-tools + 反代 Remotion Studio(:3008) */
export default defineConfig({
  plugins: [react(), operateGatePlugin(), gatewayIndexPlugin()],
  root: path.resolve(__dirname, "operate-app"),
  base: "/operate-tools/",
  server: {
    port: 3007,
    strictPort: true,
    host: true,
    proxy: {
      ...marketProxy,
      // Remotion Studio（内部 3008）：视频工程与其它 Studio 资源
      // 注意：须排除 binance-bapi（否则会被误转到 Studio，返回 nginx 404）
      "^/(?!operate-tools(?:/|$)|operate-gate(?:/|$)|operate-gate-app(?:/|$)|@vite|@fs|@id|@react-refresh|src/|node_modules/|pnl-cards(?:/|$)|binance(?:-bapi|-fapi)?(?:/|$)|bybit(?:/|$)|sina-|tencent(?:/|$)|gate(?:/|$)).*":
        {
          target: STUDIO,
          changeOrigin: true,
          ws: true,
        },
    },
  },
});
