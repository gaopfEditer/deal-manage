import React, { useState } from "react";
import { BarRacePanel } from "./panels/BarRacePanel";
import { HeatmapPanel } from "./panels/HeatmapPanel";
import { StrategyDuelPanel } from "./panels/StrategyDuelPanel";
import { FearGreedPanel } from "./panels/FearGreedPanel";
import { CodeTerminalPanel } from "./panels/CodeTerminalPanel";

const TOOLS = [
  {
    id: "race",
    name: "赛马图",
    sub: "Multi Curves",
    blurb: "纳斯达克+沪深300+BTC+银行5年期整存整取；字幕按各资产：名：盈亏（盈亏率）；tooltip 两位小数。",
  },
  {
    id: "heatmap",
    name: "清算热力图",
    sub: "Heatmap",
    blurb: "暗黑像素热力：时间 × 价位上的清算强度潮汐与关键闪烁。",
  },
  {
    id: "duel",
    name: "策略对决",
    sub: "Strategy vs B&H",
    blurb: "策略曲线 vs Buy&Hold 同屏演进，底部双账户实时计分。",
  },
  {
    id: "gauge",
    name: "恐慌贪婪仪",
    sub: "Fear & Greed",
    blurb: "赛博仪表盘指针抖动，口播用历史回调提示。",
  },
  {
    id: "terminal",
    name: "代码推演",
    sub: "Terminal",
    blurb: "终端打字机跑脚本，右侧瞬间出可视化结果。",
  },
] as const;

type ToolId = (typeof TOOLS)[number]["id"];

/** 独立全屏运营工具台（不走 Remotion Studio 预览框） */
export const OperateTools: React.FC = () => {
  const [active, setActive] = useState<ToolId>("race");
  const current = TOOLS.find((t) => t.id === active) ?? TOOLS[0];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        boxSizing: "border-box",
        background:
          "radial-gradient(1200px 600px at 10% -10%, #1f1630 0%, transparent 55%), radial-gradient(900px 500px at 90% 0%, #122033 0%, transparent 50%), #0d1117",
        color: "#e6edf3",
        fontFamily: '"IBM Plex Sans","PingFang SC","Hiragino Sans GB",sans-serif',
        padding: "20px 24px 20px",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <header style={{ flexShrink: 0, marginBottom: 16 }}>
        <div
          style={{
            fontSize: 12,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#f0883e",
            fontWeight: 700,
          }}
        >
          Operate Tools
        </div>
        <h1 style={{ margin: "6px 0 6px", fontSize: 28, fontWeight: 800 }}>运营可视化工具台</h1>
        <p style={{ margin: 0, color: "#8b949e", lineHeight: 1.5, fontSize: 13 }}>
          全屏独立页 · 多币日线对比 / 清算热力 / 策略对决 / 情绪仪表 / 代码推演
        </p>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
          gap: 8,
          marginBottom: 12,
          flexShrink: 0,
        }}
      >
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActive(t.id)}
            style={{
              textAlign: "left",
              padding: "12px 14px",
              borderRadius: 12,
              border: active === t.id ? "1px solid #f0883e" : "1px solid #30363d",
              background: active === t.id ? "#1c2128" : "#161b22",
              color: "inherit",
              cursor: "pointer",
              boxShadow:
                active === t.id ? "inset 0 0 0 1px rgba(240,136,62,0.35)" : "none",
            }}
          >
            <span style={{ display: "block", fontWeight: 700, fontSize: 14 }}>{t.name}</span>
            <span style={{ display: "block", marginTop: 3, color: "#8b949e", fontSize: 11 }}>
              {t.sub}
            </span>
          </button>
        ))}
      </div>

      <section
        style={{
          flex: 1,
          minHeight: 0,
          border: "1px solid #30363d",
          borderRadius: 16,
          background: "rgba(22,27,34,0.92)",
          padding: "14px 16px 16px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ marginBottom: 10, flexShrink: 0 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>{current.name}</h2>
          <p style={{ margin: 0, color: "#8b949e", fontSize: 12 }}>{current.blurb}</p>
        </div>
        <div
          className="ops-scroll"
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            scrollbarWidth: "thin",
            scrollbarColor: "#484f58 #161b22",
          }}
        >
          {active === "race" && <BarRacePanel />}
          {active === "heatmap" && <HeatmapPanel />}
          {active === "duel" && <StrategyDuelPanel />}
          {active === "gauge" && <FearGreedPanel />}
          {active === "terminal" && <CodeTerminalPanel />}
        </div>
      </section>
    </div>
  );
};
