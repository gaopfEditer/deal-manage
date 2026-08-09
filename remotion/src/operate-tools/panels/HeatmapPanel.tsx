import React, { useEffect, useRef, useState } from "react";
import * as echarts from "echarts/dist/echarts.js";
import { buildLiquidationHeatmap } from "../../lib/operateDemoData";

export const HeatmapPanel: React.FC = () => {
  const [days, setDays] = useState(90);
  const [pulsing, setPulsing] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const base = useRef(buildLiquidationHeatmap({ days: 90 }));
  const pulseTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const render = (data: [number, number, number][]) => {
    const b = base.current;
    chart.current?.setOption({
      backgroundColor: "transparent",
      tooltip: {
        position: "top",
        formatter: (p: { value: number[] }) =>
          `${b.xLabels[p.value[0]]} @ ${b.yLabels[p.value[1]]}<br/>清算强度 ${p.value[2]}`,
      },
      grid: { left: 56, right: 24, top: 24, bottom: 48 },
      xAxis: {
        type: "category",
        data: b.xLabels,
        axisLabel: { color: "#8b949e", interval: Math.floor(b.xLabels.length / 8) },
      },
      yAxis: {
        type: "category",
        data: b.yLabels,
        axisLabel: { color: "#8b949e" },
      },
      visualMap: {
        min: 0,
        max: 80,
        calculable: true,
        orient: "horizontal",
        left: "center",
        bottom: 0,
        textStyle: { color: "#8b949e" },
        inRange: {
          color: ["#0d1117", "#21262d", "#9e6a03", "#f0883e", "#ff7b72", "#ffdcd7"],
        },
      },
      series: [
        {
          type: "heatmap",
          data,
          emphasis: {
            itemStyle: { shadowBlur: 18, shadowColor: "rgba(255,120,80,0.85)" },
          },
        },
      ],
    });
  };

  const rebuild = () => {
    setPulsing(false);
    if (pulseTimer.current) clearInterval(pulseTimer.current);
    base.current = buildLiquidationHeatmap({ days });
    render(base.current.data);
  };

  useEffect(() => {
    if (!chartRef.current) return;
    chart.current = echarts.init(chartRef.current);
    rebuild();
    const onResize = () => chart.current?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (pulseTimer.current) clearInterval(pulseTimer.current);
      chart.current?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePulse = () => {
    if (pulsing) {
      setPulsing(false);
      if (pulseTimer.current) clearInterval(pulseTimer.current);
      render(base.current.data);
      return;
    }
    setPulsing(true);
    let t = 0;
    pulseTimer.current = setInterval(() => {
      t += 1;
      const data = base.current.data.map(([x, y, v]) => {
        const nearKey = Math.abs(y - 14) < 2 && x > days * 0.65;
        const flash = nearKey ? v * (1.2 + Math.sin(t / 2 + y) * 0.55) : v;
        return [x, y, Math.round(flash)] as [number, number, number];
      });
      render(data);
    }, 180);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <label style={{ color: "#8b949e", fontSize: 12 }}>
          天数{" "}
          <input
            type="number"
            min={30}
            max={180}
            value={days}
            onChange={(e) => setDays(Number(e.target.value) || 90)}
            style={inputStyle}
          />
        </label>
        <button type="button" style={btnStyle} onClick={rebuild}>
          刷新热力
        </button>
        <button type="button" style={pulsing ? btnWarn : btnStyle} onClick={togglePulse}>
          {pulsing ? "停止闪烁" : "模拟清算潮"}
        </button>
        <span style={{ color: "#ff7b72", fontSize: 12 }}>关键价位闪烁 = 高倍清算聚集</span>
      </div>
      <div ref={chartRef} style={chartStyle} />
    </div>
  );
};

const inputStyle: React.CSSProperties = {
  width: 80,
  marginLeft: 6,
  background: "#0d1117",
  border: "1px solid #30363d",
  color: "#e6edf3",
  borderRadius: 8,
  padding: "6px 8px",
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
const btnWarn: React.CSSProperties = { ...btnStyle, background: "#d29922" };
const chartStyle: React.CSSProperties = {
  width: "100%",
  height: 520,
  background: "#0d1117",
  border: "1px solid #21262d",
  borderRadius: 12,
};
