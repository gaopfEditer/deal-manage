import React, { useEffect, useRef, useState } from "react";
import * as echarts from "echarts/dist/echarts.js";
import { buildHoldSeries, formatMoney } from "../../lib/operateDemoData";

const CODE = `import requests

# 监控大户筹码分布（演示）
symbols = ["BTC", "ETH", "SOL", "BNB"]
capital = 1_000_000
start = "2020-01-01"

def hold_pnl(symbol):
    # fetch_ohlcv → equity curve
    return equity_curve(symbol, capital, start)

for s in symbols:
    curve = hold_pnl(s)
    print(f"{s}: {curve[-1]:,.0f}")
`;

export const CodeTerminalPanel: React.FC = () => {
  const [typed, setTyped] = useState("");
  const [running, setRunning] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;
    chart.current = echarts.init(chartRef.current);
    const onResize = () => chart.current?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.current?.dispose();
    };
  }, []);

  const reset = () => {
    setRunning(false);
    if (timer.current) clearInterval(timer.current);
    setTyped("");
    chart.current?.clear();
  };

  const paint = () => {
    const hold = buildHoldSeries({
      symbols: ["BTC", "ETH", "SOL", "BNB"],
      startDate: "2020-01-01",
      initialCapital: 1_000_000,
    });
    const last = hold.dates.length - 1;
    const names = hold.symbols;
    const values = names.map((s) => hold.series[s][last]);
    chart.current?.setOption({
      backgroundColor: "transparent",
      title: {
        text: "跑出来的结果：持有至今资产",
        left: 12,
        top: 8,
        textStyle: { color: "#c9d1d9", fontSize: 14 },
      },
      grid: { left: 48, right: 16, top: 48, bottom: 32 },
      xAxis: { type: "category", data: names, axisLabel: { color: "#8b949e" } },
      yAxis: {
        type: "value",
        axisLabel: { color: "#8b949e", formatter: (v: number) => formatMoney(v) },
        splitLine: { lineStyle: { color: "#21262d" } },
      },
      series: [
        {
          type: "bar",
          data: values,
          itemStyle: { color: "#3fb950", borderRadius: [8, 8, 0, 0] },
          label: {
            show: true,
            position: "top",
            color: "#c9d1d9",
            formatter: (p: { value: number }) => formatMoney(p.value),
          },
        },
      ],
    });
  };

  const run = () => {
    reset();
    setRunning(true);
    let i = 0;
    timer.current = setInterval(() => {
      i += 2;
      setTyped(CODE.slice(0, i));
      if (i >= CODE.length) {
        if (timer.current) clearInterval(timer.current);
        setRunning(false);
        paint();
      }
    }, 18);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <button type="button" style={btnStyle} disabled={running} onClick={run}>
          运行推演
        </button>
        <button type="button" style={btnGhost} onClick={reset}>
          清空
        </button>
        <span style={{ color: "#8b949e", fontSize: 12, alignSelf: "center" }}>
          Typewriter + 即时出图
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 12 }}>
        <pre style={termStyle}>
          <code>
            {typed}
            {(running || typed) && <span style={caretStyle}>▍</span>}
          </code>
        </pre>
        <div ref={chartRef} style={chartStyle} />
      </div>
    </div>
  );
};

const btnStyle: React.CSSProperties = {
  background: "#f0883e",
  border: "none",
  color: "#0d1117",
  fontWeight: 700,
  borderRadius: 8,
  padding: "8px 14px",
  cursor: "pointer",
};
const btnGhost: React.CSSProperties = { ...btnStyle, background: "#21262d", color: "#e6edf3" };
const termStyle: React.CSSProperties = {
  margin: 0,
  minHeight: 420,
  padding: "16px 18px",
  background: "#010409",
  border: "1px solid #238636",
  borderRadius: 12,
  color: "#3fb950",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: 13,
  lineHeight: 1.55,
  whiteSpace: "pre-wrap",
  overflow: "auto",
};
const caretStyle: React.CSSProperties = {
  display: "inline-block",
  width: 8,
  background: "#3fb950",
};
const chartStyle: React.CSSProperties = {
  minHeight: 420,
  background: "#0d1117",
  border: "1px solid #21262d",
  borderRadius: 12,
};
