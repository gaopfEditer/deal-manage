import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

/** 运营工具独立全屏页（不进 Remotion Studio 预览框） */
export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, "operate-app"),
  resolve: {
    alias: {
      // 与 Remotion 工程一致，显式指向 echarts UMD
    },
  },
  server: {
    port: 3010,
    strictPort: true,
    proxy: {
      "/binance": {
        // api.binance.com 在部分网络不可达；官方公开行情镜像
        target: "https://data-api.binance.vision",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/binance/, ""),
      },
      "/sina-cn": {
        target: "https://money.finance.sina.com.cn",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/sina-cn/, ""),
        headers: {
          Referer: "https://finance.sina.com.cn",
        },
      },
      "/sina-us": {
        target: "https://stock.finance.sina.com.cn",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/sina-us/, ""),
        headers: {
          Referer: "https://stock.finance.sina.com.cn",
        },
      },
      "/tencent": {
        target: "https://proxy.finance.qq.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/tencent/, ""),
        headers: {
          Referer: "https://finance.qq.com",
        },
      },
      "/gate": {
        // Gate 现货日线：BTC 历史约至 2013（早于 Binance 现货）
        target: "https://api.gateio.ws",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/gate/, ""),
      },
      "/binance-bapi": {
        target: "https://www.binance.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/binance-bapi/, ""),
        headers: {
          Origin: "https://www.binance.com",
          Referer: "https://www.binance.com/",
        },
      },
    },
  },
});
