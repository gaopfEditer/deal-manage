import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const STUDIO = "http://127.0.0.1:3008";

const marketProxy = {
  "/binance": {
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
  plugins: [react(), gatewayIndexPlugin()],
  root: path.resolve(__dirname, "operate-app"),
  base: "/operate-tools/",
  server: {
    port: 3007,
    strictPort: true,
    host: true,
    proxy: {
      ...marketProxy,
      // Remotion Studio（内部 3008）：视频工程与其它 Studio 资源
      "^/(?!operate-tools(?:/|$)|@vite|@fs|@id|@react-refresh|src/|node_modules/|binance(?:/|$)|sina-|tencent(?:/|$)|gate(?:/|$)).*":
        {
          target: STUDIO,
          changeOrigin: true,
          ws: true,
        },
    },
  },
});
