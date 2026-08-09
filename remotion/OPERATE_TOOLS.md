# 运营工具台 + Remotion（统一 :3007）

```bash
cd remotion
pnpm install
pnpm run dev
```

若 **3007** 已被占用会先杀掉再启动。

| 路由 | 说明 |
|------|------|
| http://localhost:3007/operate-tools/ | 运营工具台（全屏，不进 Studio 预览框） |
| http://localhost:3007/json-eth-overview | ETH 视频工程（Remotion Studio） |
| http://localhost:3007/ | 入口导航 |

内部：Studio 跑在 `3008`，由网关反代；行情 API 仍走 `/binance` `/gate` `/tencent` 等代理。

## 赛马图（多来源组合曲线）

- **多来源组合**：`Gate 币`（BTC 约 2013-03 起）/ `Binance 币`（约 2017-08 起）/ `新浪指数股` / `银行5年期整存整取` / 自定义  
  预设：纳斯达克 + 沪深300 + **BTC(Gate)** + 银行5年期整存整取  
  定存利率：内置 2000–2026 粗线条挂牌分段，时间加权均值约 **3.2%**
- **加载**：不自动请求；点「加载组合」按起止日期拉全量。同日期+资产最多缓存 **5** 组；「强制刷新」跳过缓存
- **字幕**：默认 `{date}\n{pnlLines}` → `币种：盈亏（盈亏率）`
