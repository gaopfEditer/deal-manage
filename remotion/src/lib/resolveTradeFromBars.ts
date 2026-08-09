import { parseTradingViewBars } from "../timeline/elements/echartEthKlinePreset";
import { applyProjectTrade } from "./applyProjectTrade";
import {
  coercePrice,
  findBarIndexAtTime,
  isMarketPrice,
} from "./klineTime";
import type { ProjectTrade, VideoProject } from "./types";

function roundPrice(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function roundPct(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 入场/出场价取对应时间 K 线收盘价；
 * 收益率 = 价格涨跌幅 × 杠杆（默认 20x）；收获 = 开仓价值 × 杠杆收益率。
 */
export function resolveTradeFromBars(project: VideoProject): VideoProject {
  const trade = project.trade;
  if (!trade?.entry?.time) return project;

  const tvLayer = project.timeline.find(
    (l) => l.type === "echart_panel" && l.props.tradingViewData?.bars?.length
  );
  if (!tvLayer || tvLayer.type !== "echart_panel") return project;

  const bars = tvLayer.props.tradingViewData?.bars;
  if (!bars?.length) return project;

  const { categories, ohlc } = parseTradingViewBars(bars);
  const side = trade.side === "short" ? "short" : "long";
  const leverage = trade.leverage != null && trade.leverage > 0 ? trade.leverage : 20;

  const entryIdx = findBarIndexAtTime(categories, trade.entry.time);
  if (entryIdx < 0) return project;

  const [, entryClose] = ohlc[entryIdx];
  const entryPrice =
    !isMarketPrice(trade.entry.price) && coercePrice(trade.entry.price) != null
      ? (coercePrice(trade.entry.price) as number)
      : roundPrice(entryClose);

  let exitPrice: number | undefined = coercePrice(trade.takeProfit?.price);
  let exitIdx = -1;
  if (trade.takeProfit?.time) {
    exitIdx = findBarIndexAtTime(categories, trade.takeProfit.time);
    if (exitIdx >= 0) {
      const [, tpClose] = ohlc[exitIdx];
      if (exitPrice == null || isMarketPrice(trade.takeProfit.price)) {
        exitPrice = roundPrice(tpClose);
      }
    }
  }
  if (exitPrice == null) {
    exitIdx = ohlc.length - 1;
    exitPrice = roundPrice(ohlc[exitIdx][1]);
  }

  const priceReturn =
    entryPrice === 0
      ? 0
      : side === "long"
        ? (exitPrice - entryPrice) / entryPrice
        : (entryPrice - exitPrice) / entryPrice;

  // 杠杆收益率（展示用）
  const returnPercent = roundPct(priceReturn * leverage * 100);
  const notional = trade.notional ?? trade.entryValue ?? 10_000;
  // 开仓价值按保证金：收获 = 保证金 × 价格涨跌 × 杠杆
  const profit = Math.round(notional * priceReturn * leverage * 100) / 100;

  const nextTrade: ProjectTrade = {
    ...trade,
    leverage,
    entry: {
      ...trade.entry,
      time: categories[entryIdx] ?? trade.entry.time,
      price: entryPrice,
    },
    takeProfit: trade.takeProfit
      ? {
          ...trade.takeProfit,
          time:
            exitIdx >= 0
              ? categories[exitIdx] ?? trade.takeProfit.time
              : trade.takeProfit.time,
          price: exitPrice,
        }
      : {
          time: categories[categories.length - 1],
          price: exitPrice,
          label: "止盈点",
        },
    exitPrice,
    // 保留 JSON 百分比配置（勿写成绝对价，否则丢失 offsetPercent）
    takeProfitLine: trade.takeProfitLine,
    stopLossLine: trade.stopLossLine,
    returnPercent,
    profit,
    entryValue: notional,
    notional,
  };

  return applyProjectTrade({ ...project, trade: nextTrade });
}
