import React, { useLayoutEffect, useMemo, useRef } from "react";
/**
 * Remotion/Webpack 对 package exports 的解析有时拿不到裸 `echarts`，
 * 显式指向 UMD 入口更稳（与 npm 包内 dist 一致）。
 */
import * as echarts from "echarts/dist/echarts.js";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { EchartPanelLayer } from "../../lib/types";
import { resolveSemanticPosition } from "../../lib/layout";
import type { OhlcTuple } from "./echartKlineHelpers";
import {
  clampEmaPeriod,
  closesFromOhlc,
  computeEma,
  detectShootingStarIndices,
} from "./echartKlineHelpers";
import { buildTradingViewPresetFromData } from "./echartEthKlinePreset";
import { buildTradingViewCandlestickOption } from "./echartTradingViewOption";

type Props = {
  layer: EchartPanelLayer;
  durationInFrames: number;
};

function buildSeriesData(
  chart: EchartPanelLayer["props"]["chart"],
  trend: EchartPanelLayer["props"]["trend"],
  count: number
): { categories: string[]; values: number[]; ohlc?: OhlcTuple[] } {
  const up = trend === "up";
  const categories = Array.from({ length: count }, (_, i) => `T${i + 1}`);
  if (chart === "candlestick") {
    const ohlc: OhlcTuple[] = [];
    let last = up ? 20 : 80;
    for (let i = 0; i < count; i++) {
      const open = last;
      const delta = up ? 2 + (i % 3) : -(2 + (i % 3));
      const close = open + delta;
      const high = Math.max(open, close) + 3;
      const low = Math.min(open, close) - 3;
      ohlc.push([open, close, low, high]);
      last = close;
    }
    return { categories, values: [], ohlc };
  }
  const values: number[] = [];
  let v = up ? 12 : 88;
  for (let i = 0; i < count; i++) {
    v += up ? 4 + (i % 4) : -(4 + (i % 4));
    v = Math.max(4, Math.min(96, v));
    values.push(v);
  }
  return { categories, values };
}

export const EchartPanel: React.FC<Props> = ({ layer, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);

  const {
    chart,
    trend,
    title,
    position,
    containerStyle,
    vegasChannel,
    shootingStar,
    tradingViewStyle,
    fullscreen,
    tradingViewData,
    callouts,
  } = layer.props;
  const isTradingView =
    chart === "candlestick" &&
    tradingViewStyle === true &&
    Boolean(tradingViewData);
  const pos = resolveSemanticPosition(typeof position === "string" ? position : undefined);
  const tvPreset = useMemo(
    () =>
      isTradingView && tradingViewData
        ? buildTradingViewPresetFromData(tradingViewData)
        : null,
    [isTradingView, tradingViewData]
  );

  const outerStyle: React.CSSProperties = {};
  if (containerStyle && typeof containerStyle === "object") {
    for (const [k, v] of Object.entries(containerStyle)) {
      (outerStyle as Record<string, string | number>)[k] = v;
    }
  }

  const settlementHoldFrames =
    isTradingView && tvPreset?.signal?.settlement
      ? Math.round(tvPreset.signal.settlement.holdSeconds * fps)
      : 0;
  const chartAnimFrames = Math.max(1, durationInFrames - settlementHoldFrames);
  const progress = interpolate(frame, [0, Math.max(1, chartAnimFrames - 1)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const totalPoints =
    isTradingView && tvPreset ? tvPreset.ohlc.length : chart === "candlestick" ? 28 : 14;
  const visible = Math.max(2, Math.ceil(totalPoints * progress));

  const { option } = useMemo(() => {
    if (isTradingView && tvPreset) {
      return {
        option: buildTradingViewCandlestickOption({
          preset: tvPreset,
          visible,
          vegasChannel,
          shootingStar,
          extraCallouts: callouts,
          bollinger: tradingViewData?.bollinger,
        }),
      };
    }

    const { categories, values, ohlc } = buildSeriesData(chart, trend, totalPoints);
    const up = trend === "up";
    const lineColor = up ? "#4ade80" : "#fb7185";
    const barColor = up ? "#22c55e" : "#ef4444";

    const baseGrid = { left: "10%", right: "8%", top: title ? 52 : 28, bottom: "12%" };

    if (chart === "line") {
      return {
        option: {
          backgroundColor: "transparent",
          title: title
            ? { text: title, left: "center", top: 6, textStyle: { color: "#e2e8f8", fontSize: 18 } }
            : undefined,
          grid: baseGrid,
          xAxis: { type: "category", data: categories.slice(0, visible), axisLabel: { color: "#94a3b8" } },
          yAxis: { type: "value", min: 0, max: 100, axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "rgba(148,163,184,0.15)" } } },
          series: [
            {
              type: "line",
              data: values.slice(0, visible),
              smooth: true,
              symbol: "circle",
              lineStyle: { width: 3, color: lineColor },
              itemStyle: { color: lineColor },
              areaStyle: { color: `${lineColor}33` },
            },
          ],
        },
      };
    }

    if (chart === "bar") {
      return {
        option: {
          backgroundColor: "transparent",
          title: title
            ? { text: title, left: "center", top: 6, textStyle: { color: "#e2e8f8", fontSize: 18 } }
            : undefined,
          grid: baseGrid,
          xAxis: { type: "category", data: categories.slice(0, visible), axisLabel: { color: "#94a3b8" } },
          yAxis: { type: "value", min: 0, max: 100, axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "rgba(148,163,184,0.15)" } } },
          series: [
            {
              type: "bar",
              data: values.slice(0, visible).map((v) => ({
                value: v,
                itemStyle: { color: barColor, borderRadius: [4, 4, 0, 0] },
              })),
            },
          ],
        },
      };
    }

    // candlestick + 可选：维加斯通道（双 EMA）/ 射击之星标注
    let fullOhlc = (ohlc || []) as OhlcTuple[];
    if (shootingStar?.autoDetect && fullOhlc.length >= 8) {
      const i = Math.min(6, fullOhlc.length - 2);
      const anchor = fullOhlc[i][1];
      const next = [...fullOhlc] as OhlcTuple[];
      next[i] = [anchor + 2.2, anchor - 0.9, anchor - 2.1, anchor + 14];
      fullOhlc = next;
    }

    const cat = categories.slice(0, visible);
    const data = fullOhlc.slice(0, visible);

    const vegasOn = Boolean(vegasChannel?.enabled);
    const p1 = vegasOn
      ? clampEmaPeriod(vegasChannel?.emaPeriod1 ?? 144, visible)
      : 0;
    const p2 = vegasOn
      ? clampEmaPeriod(vegasChannel?.emaPeriod2 ?? 169, visible)
      : 0;

    const ema1Full = vegasOn ? computeEma(closesFromOhlc(fullOhlc), p1) : [];
    const ema2Full = vegasOn ? computeEma(closesFromOhlc(fullOhlc), p2) : [];
    const ema1 = ema1Full.slice(0, visible);
    const ema2 = ema2Full.slice(0, visible);

    const starIndices = new Set<number>();
    if (shootingStar?.indices?.length) {
      for (const n of shootingStar.indices) {
        if (n >= 0 && n < visible) starIndices.add(n);
      }
    }
    if (shootingStar?.autoDetect) {
      for (const n of detectShootingStarIndices(data)) {
        if (n < visible) starIndices.add(n);
      }
    }

    const markPointData = [...starIndices].map((i) => ({
      name: shootingStar?.label || "射击之星",
      coord: [cat[i], data[i][3]] as [string, number],
      value: data[i][3],
      symbol: "pin",
      symbolSize: 48,
      itemStyle: { color: "#fbbf24", borderColor: "#f59e0b" },
      label: { show: true, formatter: shootingStar?.label || "射击之星", color: "#0f172a" },
    }));

    const extraSeries: object[] = [];
    if (vegasOn && ema1.length && ema2.length) {
      const fill = Boolean(vegasChannel?.fill);
      if (fill) {
        const lowBand: number[] = [];
        const spanBand: number[] = [];
        for (let i = 0; i < visible; i++) {
          const a = ema1[i];
          const b = ema2[i];
          if (a == null || b == null) {
            lowBand.push(0);
            spanBand.push(0);
          } else {
            lowBand.push(Math.min(a, b));
            spanBand.push(Math.abs(a - b));
          }
        }
        extraSeries.push({
          type: "line",
          name: "Vegas band base",
          data: lowBand,
          stack: "vegasBand",
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 0, opacity: 0 },
          silent: true,
          z: 1,
        });
        extraSeries.push({
          type: "line",
          name: "Vegas band span",
          data: spanBand,
          stack: "vegasBand",
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 0, opacity: 0 },
          areaStyle: { color: "rgba(56, 189, 248, 0.22)" },
          silent: true,
          z: 1,
        });
      }
      extraSeries.push({
        type: "line",
        name: `EMA(${p1})`,
        data: ema1,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2, color: "#38bdf8" },
        z: 2,
      });
      extraSeries.push({
        type: "line",
        name: `EMA(${p2})`,
        data: ema2,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2, color: "#e879f9" },
        z: 2,
      });
    }

    return {
      option: {
        backgroundColor: "transparent",
        title: title
          ? { text: title, left: "center", top: 6, textStyle: { color: "#e2e8f8", fontSize: 18 } }
          : undefined,
        tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
        legend: vegasOn
          ? {
              bottom: 0,
              textStyle: { color: "#94a3b8" },
              data: [`EMA(${p1})`, `EMA(${p2})`],
            }
          : undefined,
        grid: { ...baseGrid, bottom: vegasOn ? "14%" : "12%" },
        xAxis: { type: "category", data: cat, axisLabel: { color: "#94a3b8" } },
        yAxis: { scale: true, axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "rgba(148,163,184,0.15)" } } },
        series: [
          {
            type: "candlestick",
            data,
            itemStyle: {
              color: "#34d399",
              color0: "#fb7185",
              borderColor: "#34d399",
              borderColor0: "#fb7185",
            },
            markPoint: markPointData.length ? { data: markPointData, z: 10 } : undefined,
            z: 3,
          },
          ...(extraSeries as never[]),
        ],
      },
    };
  }, [
    chart,
    trend,
    title,
    visible,
    vegasChannel,
    shootingStar,
    isTradingView,
    tvPreset,
    tradingViewData?.bollinger,
    callouts,
    totalPoints,
  ]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!inst.current) {
      inst.current = echarts.init(el, undefined, { renderer: "canvas" });
    }
    inst.current.setOption(option, true);
    inst.current.resize();
  }, [option]);

  useLayoutEffect(() => {
    return () => {
      inst.current?.dispose();
      inst.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const onResize = () => inst.current?.resize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (isTradingView && tvPreset && (fullscreen || tradingViewStyle)) {
    // 头部价格随 K 线推进更新：约 5Hz 取档，避免每帧乱跳又保持可读
    const tickEvery = Math.max(4, Math.round(fps / 5));
    const tickFrame = Math.min(
      chartAnimFrames - 1,
      Math.floor(frame / tickEvery) * tickEvery
    );
    const tickProgress = interpolate(
      tickFrame,
      [0, Math.max(1, chartAnimFrames - 1)],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    );
    const liveIdx = Math.min(
      tvPreset.ohlc.length - 1,
      Math.max(0, Math.ceil(tvPreset.ohlc.length * tickProgress) - 1)
    );
    const liveClose = tvPreset.ohlc[liveIdx][1];
    const openRef = tvPreset.ohlc[0][1];
    const liveChange =
      Math.round((liveClose - openRef) * 100) / 100;
    const liveChangePercent =
      openRef === 0
        ? 0
        : Math.round((liveChange / openRef) * 10000) / 100;
    const changeColor = liveChange < 0 ? "#ef5350" : "#26a69a";
    const changeSign = liveChange >= 0 ? "+" : "";
    const settlement = tvPreset.signal?.settlement;
    // 片尾 holdSeconds 内展示结算卡（默认 5s）
    const fadeIn = Math.min(12, Math.max(4, Math.floor(settlementHoldFrames * 0.15)));
    const settlementOpacity = settlement
      ? interpolate(
          frame,
          [chartAnimFrames, chartAnimFrames + fadeIn],
          [0, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        )
      : 0;
    const pnlColor =
      settlement && settlement.profit >= 0 ? "#26a69a" : "#ef5350";
    const fmtSignedMoney = (n: number) =>
      `${n >= 0 ? "+" : "-"}$${Math.abs(n).toLocaleString("en-US", {
        maximumFractionDigits: 2,
      })}`;
    const fmtSignedPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

    return (
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          background: "#0f141c",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            flexShrink: 0,
            padding: "28px 24px 12px",
            borderBottom: "1px solid #2a2e39",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 34, fontWeight: 700, color: "#d1d4dc" }}>
              {tvPreset.symbol}
            </span>
            <span style={{ fontSize: 22, color: "#787b86" }}>{tvPreset.timeframe}</span>
          </div>
          <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 16 }}>
            <span style={{ fontSize: 48, fontWeight: 700, color: changeColor }}>
              {liveClose.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <span style={{ fontSize: 26, color: changeColor, fontWeight: 600 }}>
              {changeSign}
              {liveChange.toFixed(2)} ({changeSign}
              {liveChangePercent.toFixed(2)}%)
            </span>
          </div>
          <div style={{ marginTop: 8, fontSize: 20, color: "#787b86" }}>
            {title || tvPreset.vegasLegend}
          </div>
        </div>
        <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
          <div ref={ref} style={{ width: "100%", height: "100%" }} />
          {settlement && settlementOpacity > 0.01 ? (
            <div
              style={{
                position: "absolute",
                right: 28,
                bottom: 36,
                minWidth: 280,
                padding: "18px 22px",
                borderRadius: 12,
                background: "rgba(15, 20, 28, 0.92)",
                border: `1px solid ${pnlColor}66`,
                boxShadow: `0 12px 40px rgba(0,0,0,0.45), 0 0 0 1px ${pnlColor}22`,
                opacity: settlementOpacity,
                transform: `translateY(${(1 - settlementOpacity) * 16}px)`,
              }}
            >
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: "#d1d4dc",
                  marginBottom: 12,
                  letterSpacing: 2,
                }}
              >
                {settlement.label}
              </div>
              {[
                {
                  k: "开仓价值",
                  v: `$${settlement.entryValue.toLocaleString("en-US", {
                    maximumFractionDigits: 2,
                  })}`,
                  c: "#d1d4dc",
                },
                {
                  k: "收获",
                  v: fmtSignedMoney(settlement.profit),
                  c: pnlColor,
                },
                {
                  k: "收益率",
                  v: fmtSignedPct(settlement.returnPercent),
                  c: pnlColor,
                },
              ].map((row) => (
                <div
                  key={row.k}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: 24,
                    marginTop: 8,
                  }}
                >
                  <span style={{ fontSize: 16, color: "#787b86" }}>{row.k}</span>
                  <span style={{ fontSize: 22, fontWeight: 700, color: row.c }}>{row.v}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          ...pos,
          width: "86%",
          maxWidth: 920,
          height: 340,
          borderRadius: 16,
          padding: 10,
          background: "rgba(10, 14, 28, 0.82)",
          border: "1px solid rgba(120, 200, 255, 0.22)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
          ...outerStyle,
        }}
      >
        <div ref={ref} style={{ width: "100%", height: "100%" }} />
      </div>
    </AbsoluteFill>
  );
};
