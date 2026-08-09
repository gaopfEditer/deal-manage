import React, { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts/dist/echarts.js";
import {
  buildHoldSeries,
  buildStrategyDuel,
  formatMoney,
} from "../../lib/operateDemoData";

const SYMBOLS = ["BTC", "ETH", "SOL", "BNB"];

export const StrategyDuelPanel: React.FC = () => {
  const [symbol, setSymbol] = useState("BTC");
  const [capital, setCapital] = useState(1_000_000);
  const [startDate, setStartDate] = useState("2020-01-01");
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState(2);
  const chartRef = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const duel = useMemo(() => {
    const hold = buildHoldSeries({
      symbols: SYMBOLS,
      startDate,
      initialCapital: capital,
    });
    return buildStrategyDuel(hold, symbol);
  }, [symbol, capital, startDate]);

  const stratNow = duel.strategy[cursor] ?? 0;
  const holdNow = duel.buyHold[cursor] ?? 0;

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

  useEffect(() => {
    setCursor(2);
    setPlaying(false);
  }, [duel]);

  useEffect(() => {
    if (!chart.current) return;
    const n = cursor + 1;
    const dates = duel.dates.slice(0, n);
    chart.current.setOption({
      backgroundColor: "transparent",
      legend: { data: ["策略", "Buy & Hold"], textStyle: { color: "#c9d1d9" }, top: 8 },
      grid: { left: 64, right: 28, top: 48, bottom: 40 },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: dates,
        axisLabel: {
          color: "#8b949e",
          interval: Math.max(0, Math.floor(dates.length / 8)),
        },
      },
      yAxis: {
        type: "log",
        axisLabel: { color: "#8b949e", formatter: (v: number) => formatMoney(v) },
        splitLine: { lineStyle: { color: "#21262d" } },
      },
      series: [
        {
          name: "策略",
          type: "line",
          showSymbol: false,
          data: duel.strategy.slice(0, n),
          lineStyle: { width: 3, color: "#3fb950" },
        },
        {
          name: "Buy & Hold",
          type: "line",
          showSymbol: false,
          data: duel.buyHold.slice(0, n),
          lineStyle: { width: 3, color: "#f0883e" },
        },
      ],
    });
  }, [cursor, duel]);

  useEffect(() => {
    if (!playing) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
    timer.current = setInterval(() => {
      setCursor((c) => {
        const step = Math.max(3, Math.floor((duel.dates.length - c) / 80));
        const next = Math.min(duel.dates.length - 1, c + step);
        if (next >= duel.dates.length - 1) setPlaying(false);
        return next;
      });
    }, 80);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, duel.dates.length]);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          style={inputStyle}
        >
          {SYMBOLS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label style={{ color: "#8b949e", fontSize: 12 }}>
          初始资金
          <input
            type="number"
            value={capital}
            step={100000}
            onChange={(e) => setCapital(Number(e.target.value) || 1000000)}
            style={{ ...inputStyle, width: 140, marginLeft: 6 }}
          />
        </label>
        <input
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          style={{ ...inputStyle, width: 130 }}
        />
        <button type="button" style={btnStyle} onClick={() => setPlaying((p) => !p)}>
          {playing ? "暂停演进" : "动态对决"}
        </button>
        <button
          type="button"
          style={btnGhost}
          onClick={() => {
            setPlaying(false);
            setCursor(duel.dates.length - 1);
          }}
        >
          跳到结果
        </button>
      </div>
      <div style={{ display: "flex", gap: 18, alignItems: "flex-end", marginBottom: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "#8b949e", fontSize: 12 }}>策略账户</div>
          <div style={{ color: "#3fb950", fontSize: 28, fontWeight: 800 }}>{formatMoney(stratNow)}</div>
        </div>
        <div style={{ color: "#484f58", fontWeight: 700, paddingBottom: 6 }}>VS</div>
        <div>
          <div style={{ color: "#8b949e", fontSize: 12 }}>Buy & Hold</div>
          <div style={{ color: "#f0883e", fontSize: 28, fontWeight: 800 }}>{formatMoney(holdNow)}</div>
        </div>
        <div
          style={{
            marginLeft: "auto",
            fontWeight: 700,
            color: stratNow >= holdNow ? "#3fb950" : "#ff7b72",
          }}
        >
          差值 {formatMoney(stratNow - holdNow)}（
          {((stratNow / Math.max(holdNow, 1) - 1) * 100).toFixed(1)}%）
        </div>
      </div>
      <div ref={chartRef} style={chartStyle} />
    </div>
  );
};

const inputStyle: React.CSSProperties = {
  background: "#0d1117",
  border: "1px solid #30363d",
  color: "#e6edf3",
  borderRadius: 8,
  padding: "8px 10px",
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
const chartStyle: React.CSSProperties = {
  width: "100%",
  height: 480,
  background: "#0d1117",
  border: "1px solid #21262d",
  borderRadius: 12,
};
