import type { VegasChannelProps, ShootingStarProps, KlineCallout } from "../../lib/types";
import type { OhlcTuple } from "./echartKlineHelpers";
import type { EthTradingViewPreset } from "./echartEthKlinePreset";

/** 与 kkkline.html 一致的 pin 信号标注 */
function buildQuantMarkPoints(
  cat: string[],
  ohlc: OhlcTuple[],
  callouts: KlineCallout[],
  showLastPriceArrow: boolean
) {
  const data: object[] = [];

  for (const c of callouts) {
    if (c.index < 0 || c.index >= ohlc.length || !c.text) continue;
    const [, , low, high] = ohlc[c.index];
    const isUp = c.direction === "up";
    const basePrice = isUp ? high : low;
    const offsetY = isUp ? -22 : 22;

    data.push({
      name: c.text,
      coord: [cat[c.index], basePrice],
      itemStyle: { color: c.color || "#eab308" },
      symbol: "pin",
      symbolRotate: isUp ? 180 : 0,
      symbolSize: [55, 28],
      symbolOffset: [0, offsetY],
      label: {
        show: true,
        formatter: c.text,
        fontSize: 9,
        color: c.textColor || "#fff",
        fontWeight: "bold",
        rotate: isUp ? 180 : 0,
        offset: isUp ? [0, 2] : [0, -2],
      },
    });
  }

  if (showLastPriceArrow && ohlc.length > 0) {
    const lastIdx = ohlc.length - 1;
    const high = ohlc[lastIdx][3];
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

  return { data, z: 20 };
}

function volumeBarDataQuant(ohlc: OhlcTuple[], volumes: number[]) {
  return volumes.map((vol, i) => {
    const [open, close] = ohlc[i];
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
}): Record<string, unknown> {
  const { preset, visible, extraCallouts } = args;
  const cat = preset.categories.slice(0, visible);
  const ohlc = preset.ohlc.slice(0, visible) as OhlcTuple[];
  const vols = preset.volumes.slice(0, visible);
  const v144 = preset.vegas144.slice(0, visible);
  const v169 = preset.vegas169.slice(0, visible);

  const callouts: KlineCallout[] = [...preset.callouts, ...(extraCallouts ?? [])];
  const markPoint = buildQuantMarkPoints(
    cat,
    ohlc,
    callouts,
    preset.showLastPriceArrow && visible >= preset.ohlc.length
  );

  const lineSeries: object[] = [];
  if (v144.length === visible && v169.length === visible) {
    lineSeries.push(
      {
        name: "Vegas 144",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: v144,
        showSymbol: false,
        smooth: true,
        lineStyle: { color: "#ef4444", width: 1.5 },
        z: 2,
      },
      {
        name: "Vegas 169",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: v169,
        showSymbol: false,
        smooth: true,
        lineStyle: { color: "#b91c1c", width: 1.5 },
        z: 2,
      }
    );
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
        axisLabel: { color: "#848e9c", fontSize: 10 },
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
        name: "Ethereum",
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
