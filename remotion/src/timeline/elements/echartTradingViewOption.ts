import type { VegasChannelProps, ShootingStarProps, KlineCallout } from "../../lib/types";
import { formatLinePrice } from "../../lib/tradePriceRef";
import {
  closesFromOhlc,
  computeBollinger,
  type OhlcTuple,
} from "./echartKlineHelpers";
import type { EthTradingViewPreset, ResolvedTradeSignal } from "./echartEthKlinePreset";

/** pin / 箭头气泡：tip 挂高点、bottom 挂低点 */
type CandleCell = OhlcTuple | "-";

function isCandle(row: CandleCell | null | undefined): row is OhlcTuple {
  return Array.isArray(row) && row.length >= 4;
}

function buildQuantMarkPoints(
  cat: string[],
  ohlc: CandleCell[],
  callouts: KlineCallout[],
  showLastPriceArrow: boolean
) {
  const data: object[] = [];

  for (const c of callouts) {
    if (c.index < 0 || c.index >= ohlc.length || !c.text) continue;
    const row = ohlc[c.index];
    if (!isCandle(row)) continue;
    const [, , low, high] = row;
    const atTip =
      c.anchor === "tip" || (c.anchor !== "bottom" && c.direction === "up");
    const basePrice = atTip ? high : low;
    const useArrow = c.style === "arrow" || (c.style !== "pin" && atTip);
    const bg = c.color || "#eab308";
    const fg = c.textColor || "#fff";

    if (useArrow) {
      data.push({
        name: c.text,
        coord: [cat[c.index], basePrice],
        itemStyle: { color: bg },
        symbol: "arrow",
        symbolRotate: atTip ? 180 : 0,
        symbolSize: 14,
        symbolOffset: atTip ? [0, -10] : [0, 10],
        label: {
          show: true,
          formatter: c.text,
          position: atTip ? "top" : "bottom",
          distance: 8,
          fontSize: 10,
          color: fg,
          fontWeight: "bold",
          backgroundColor: bg,
          padding: [4, 8],
          borderRadius: 4,
        },
      });
      continue;
    }

    const offsetY = atTip ? -22 : 22;
    data.push({
      name: c.text,
      coord: [cat[c.index], basePrice],
      itemStyle: { color: bg },
      symbol: "pin",
      symbolRotate: atTip ? 180 : 0,
      symbolSize: [55, 28],
      symbolOffset: [0, offsetY],
      label: {
        show: true,
        formatter: c.text,
        fontSize: 9,
        color: fg,
        fontWeight: "bold",
        rotate: atTip ? 180 : 0,
        offset: atTip ? [0, 2] : [0, -2],
      },
    });
  }

  if (showLastPriceArrow && ohlc.length > 0) {
    let lastIdx = -1;
    for (let i = ohlc.length - 1; i >= 0; i--) {
      if (isCandle(ohlc[i])) {
        lastIdx = i;
        break;
      }
    }
    if (lastIdx >= 0) {
      const high = (ohlc[lastIdx] as OhlcTuple)[3];
      data.push({
        name: "最新价格指示",
        coord: [cat[lastIdx], high],
        symbol: "path://M12 2v20m0 0l-8-8m8 8l8-8",
        symbolSize: [20, 30],
        symbolOffset: [0, "-50%"],
        itemStyle: {
          color: "#ef4444",
          shadowBlur: 10,
          shadowColor: "#ef4444",
        },
        label: { show: false },
      });
    }
  }

  return { data, z: 20 };
}

/** 发车信号：上车点 / 止盈点 markPoint + 止盈止损 markLine */
function buildSignalMarks(
  cat: string[],
  signal: ResolvedTradeSignal | undefined,
  visible: number
): { markPointData: object[]; markLine: object | undefined } {
  if (!signal || !cat.length) return { markPointData: [], markLine: undefined };

  const entryIdx = signal.entryIndex;
  const isLong = signal.side === "long";
  const markPointData: object[] = [];

  if (entryIdx >= 0 && entryIdx < cat.length && entryIdx < visible) {
    markPointData.push({
      name: signal.entryLabel,
      coord: [cat[entryIdx], signal.entryPrice],
      itemStyle: { color: isLong ? "#22c55e" : "#ef4444" },
      symbol: "arrow",
      symbolRotate: isLong ? 0 : 180,
      symbolSize: 16,
      symbolOffset: isLong ? [0, 12] : [0, -12],
      label: {
        show: true,
        formatter: signal.entryLabel,
        position: isLong ? "bottom" : "top",
        distance: 10,
        fontSize: 11,
        color: "#fff",
        fontWeight: "bold",
        backgroundColor: isLong ? "#16a34a" : "#dc2626",
        padding: [4, 8],
        borderRadius: 4,
      },
    });
  }

  if (
    signal.takeProfitIndex != null &&
    signal.takeProfitPrice != null &&
    signal.takeProfitIndex < cat.length &&
    signal.takeProfitIndex < visible
  ) {
    const tpIdx = signal.takeProfitIndex;
    markPointData.push({
      name: signal.takeProfitLabel || "止盈点",
      coord: [cat[tpIdx], signal.takeProfitPrice],
      itemStyle: { color: "#f59e0b" },
      symbol: "arrow",
      symbolRotate: isLong ? 180 : 0,
      symbolSize: 16,
      symbolOffset: isLong ? [0, -12] : [0, 12],
      label: {
        show: true,
        formatter: signal.takeProfitLabel || "止盈点",
        position: isLong ? "top" : "bottom",
        distance: 10,
        fontSize: 11,
        color: "#1a1a1a",
        fontWeight: "bold",
        backgroundColor: "#fbbf24",
        padding: [4, 8],
        borderRadius: 4,
      },
    });
  }

  const lineData: object[] = [];
  const tpLine =
    typeof signal.takeProfitLine === "number" && Number.isFinite(signal.takeProfitLine)
      ? signal.takeProfitLine
      : undefined;
  const slLine =
    typeof signal.stopLossLine === "number" && Number.isFinite(signal.stopLossLine)
      ? signal.stopLossLine
      : undefined;

  if (tpLine != null) {
    lineData.push({
      yAxis: tpLine,
      name: "止盈",
      lineStyle: { color: "#22c55e", type: "dashed", width: 1.5 },
      label: {
        show: true,
        formatter: `止盈 ${formatLinePrice(tpLine)}`,
        position: "end",
        color: "#22c55e",
        fontSize: 10,
        fontWeight: "bold",
      },
    });
  }
  if (slLine != null) {
    lineData.push({
      yAxis: slLine,
      name: "止损",
      lineStyle: { color: "#ef4444", type: "dashed", width: 1.5 },
      label: {
        show: true,
        formatter: `止损 ${formatLinePrice(slLine)}`,
        position: "end",
        color: "#ef4444",
        fontSize: 10,
        fontWeight: "bold",
      },
    });
  }

  const markLine =
    lineData.length > 0
      ? {
          symbol: ["none", "none"],
          silent: true,
          animation: false,
          data: lineData,
          z: 18,
        }
      : undefined;

  return { markPointData, markLine };
}

function volumeBarDataQuant(ohlc: CandleCell[], volumes: (number | "-")[]) {
  return volumes.map((vol, i) => {
    const row = ohlc[i];
    if (vol === "-" || !isCandle(row)) return "-";
    const [open, close] = row;
    const isUp = close >= open;
    return {
      value: vol,
      itemStyle: {
        color: isUp ? "rgba(0,176,107,0.3)" : "rgba(255,77,79,0.3)",
      },
    };
  });
}

export function buildTradingViewCandlestickOption(args: {
  preset: EthTradingViewPreset;
  visible: number;
  vegasChannel?: VegasChannelProps;
  shootingStar?: ShootingStarProps;
  extraCallouts?: KlineCallout[];
  /** 布林带；默认开启 */
  bollinger?: false | { period?: number; stdDev?: number };
}): Record<string, unknown> {
  const { preset, visible, extraCallouts, bollinger } = args;
  const total = preset.categories.length;
  const n = Math.max(0, Math.min(visible, total));

  // 横轴始终覆盖整段时间；未露出的点用 '-'（ECharts 不接受 candlestick 的 null）
  const cat = preset.categories;
  const ohlc: CandleCell[] = preset.ohlc.map((row, i) =>
    i < n ? (row as OhlcTuple) : "-"
  );
  const vols: (number | "-")[] = preset.volumes.map((v, i) => (i < n ? v : "-"));
  const v144 = preset.vegas144.map((v, i) => (i < n ? v : "-"));
  const v169 = preset.vegas169.map((v, i) => (i < n ? v : "-"));

  const callouts: KlineCallout[] = [...preset.callouts, ...(extraCallouts ?? [])].filter(
    (c) => c.index < n
  );
  const markPoint = buildQuantMarkPoints(
    cat,
    ohlc,
    callouts,
    preset.showLastPriceArrow && n >= total
  );
  const { markPointData: signalPoints, markLine } = buildSignalMarks(
    cat,
    preset.signal,
    n
  );
  if (signalPoints.length) {
    markPoint.data = [...(markPoint.data as object[]), ...signalPoints];
  }

  const lineSeries: object[] = [];
  if (preset.vegas144.length === total && preset.vegas169.length === total) {
    lineSeries.push(
      {
        name: "Vegas 144",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: v144,
        showSymbol: false,
        connectNulls: false,
        smooth: true,
        lineStyle: { color: "#ef4444", width: 1.5 },
        z: 2,
      } as object,
      {
        name: "Vegas 169",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: v169,
        showSymbol: false,
        connectNulls: false,
        smooth: true,
        lineStyle: { color: "#b91c1c", width: 1.5 },
        z: 2,
      } as object
    );
  }

  if (bollinger !== false && total > 0) {
    const period = bollinger?.period ?? 20;
    const stdDev = bollinger?.stdDev ?? 2;
    // 用 warmup 收盘价预热，展示窗口从首根起就有布林；seed 本身不画
    const seed = preset.indicatorSeedCloses ?? [];
    const closes = [...seed, ...closesFromOhlc(preset.ohlc as OhlcTuple[])];
    const bbFull = computeBollinger(closes, period, stdDev);
    const mid = bbFull.mid.slice(seed.length).map((v, i) => (i < n ? v ?? "-" : "-"));
    const upper = bbFull.upper.slice(seed.length).map((v, i) => (i < n ? v ?? "-" : "-"));
    const lower = bbFull.lower.slice(seed.length).map((v, i) => (i < n ? v ?? "-" : "-"));
    lineSeries.push(
      {
        name: "BOLL 上轨",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: upper,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { color: "#60a5fa", width: 1, type: "dashed" },
        z: 2,
      },
      {
        name: "BOLL 中轨",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: mid,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { color: "#93c5fd", width: 1 },
        z: 2,
      },
      {
        name: "BOLL 下轨",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: lower,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { color: "#60a5fa", width: 1, type: "dashed" },
        z: 2,
      }
    );
  }

  // 把止盈/止损线纳入 Y 轴范围，避免被 scale 裁掉看起来「没变化」
  const priceExtents: number[] = [];
  for (let i = 0; i < n; i++) {
    const row = ohlc[i];
    if (!isCandle(row)) continue;
    priceExtents.push(row[2], row[3]);
  }
  const sig = preset.signal;
  if (typeof sig?.takeProfitLine === "number") priceExtents.push(sig.takeProfitLine);
  if (typeof sig?.stopLossLine === "number") priceExtents.push(sig.stopLossLine);
  if (typeof sig?.entryPrice === "number") priceExtents.push(sig.entryPrice);
  if (typeof sig?.takeProfitPrice === "number") priceExtents.push(sig.takeProfitPrice);

  let yMin: number | undefined;
  let yMax: number | undefined;
  if (priceExtents.length) {
    const lo = Math.min(...priceExtents);
    const hi = Math.max(...priceExtents);
    const pad = (hi - lo) * 0.04 || Math.abs(hi) * 0.02 || 0.0001;
    yMin = lo - pad;
    yMax = hi + pad;
  }

  return {
    backgroundColor: "transparent",
    animation: false,
    grid: [
      { id: "klineGrid", left: "5%", right: "16%", top: "6%", height: "68%" },
      { id: "volumeGrid", left: "5%", right: "16%", top: "78%", height: "14%" },
    ],
    xAxis: [
      {
        type: "category",
        data: cat,
        gridIndex: 0,
        scale: true,
        boundaryGap: true,
        axisLine: { lineStyle: { color: "#262f3d" } },
        axisLabel: {
          color: "#848e9c",
          fontSize: 10,
          hideOverlap: true,
        },
      },
      {
        type: "category",
        data: cat,
        gridIndex: 1,
        scale: true,
        boundaryGap: true,
        show: false,
      },
    ],
    yAxis: [
      {
        type: "value",
        gridIndex: 0,
        scale: true,
        min: yMin,
        max: yMax,
        position: "right",
        splitLine: { lineStyle: { color: "#1e2530" } },
        axisLine: { lineStyle: { color: "#262f3d" } },
        axisLabel: { color: "#cbcfd5", fontSize: 10 },
      },
      {
        type: "value",
        gridIndex: 1,
        scale: true,
        show: false,
      },
    ],
    series: [
      {
        name: "K线",
        type: "candlestick",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: ohlc,
        itemStyle: {
          color: "#00b06b",
          color0: "#ff4d4f",
          borderColor: "#00b06b",
          borderColor0: "#ff4d4f",
        },
        markPoint,
        ...(markLine ? { markLine } : {}),
        z: 5,
      },
      ...lineSeries,
      {
        name: "Volume",
        type: "bar",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: volumeBarDataQuant(ohlc, vols),
        barWidth: "55%",
        z: 3,
      },
    ],
  };
}
