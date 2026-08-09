import {
  expandRangeFromEntryExit,
  intervalToTimeframeLabel,
  normalizeBinanceInterval,
  coercePrice,
} from "./klineTime";
import type {
  PnlCoverLayer,
  ProjectTrade,
  TimelineLayer,
  TradingViewKlineDataInput,
  VideoProject,
} from "./types";

function resolveKlineWindow(trade: ProjectTrade): {
  interval: string;
  start: string;
  end: string;
  warmupBars?: number;
  source?: "binance";
} | null {
  const kline = trade.kline;
  if (!kline?.interval && !trade.entry?.time) return null;

  const interval = normalizeBinanceInterval(kline?.interval || "15m");
  const padRatio = kline?.padRatio ?? 0.2;

  if (kline?.start && kline?.end) {
    return {
      source: kline.source ?? "binance",
      interval,
      start: kline.start,
      end: kline.end,
      warmupBars: kline.warmupBars,
    };
  }

  if (!trade.entry?.time) return null;
  const range = expandRangeFromEntryExit({
    entryTime: trade.entry.time,
    exitTime: trade.takeProfit?.time,
    interval,
    padRatio,
  });
  return {
    source: kline?.source ?? "binance",
    interval,
    start: range.start,
    end: range.end,
    warmupBars: kline?.warmupBars,
  };
}

function mergePnlCover(
  layer: PnlCoverLayer,
  trade: ProjectTrade
): PnlCoverLayer {
  const notional = trade.notional ?? trade.entryValue ?? 10_000;
  const leverage = trade.leverage ?? 20;
  const returnPercent = trade.returnPercent ?? layer.props.returnPercent ?? 0;
  const profit =
    trade.profit != null
      ? trade.profit
      : Math.round(notional * (returnPercent / 100) * 100) / 100;
  const entryPrice =
    coercePrice(trade.entry.price) ?? layer.props.entryPrice;
  const exitPrice =
    trade.exitPrice ??
    coercePrice(trade.takeProfit?.price) ??
    layer.props.exitPrice;

  return {
    ...layer,
    props: {
      symbol: layer.props.symbol ?? trade.symbol,
      title: layer.props.title ?? trade.title ?? `${trade.symbol} 发车复盘`,
      subtitle: layer.props.subtitle ?? trade.subtitle,
      side: layer.props.side ?? trade.side ?? "long",
      tag: layer.props.tag ?? trade.tag,
      // trade 为源：resolve 后的收益率/价格必须覆盖首轮占位 0
      returnPercent,
      profit,
      entryValue: trade.entryValue ?? layer.props.entryValue ?? notional,
      entryTime: trade.entry.time ?? layer.props.entryTime,
      entryPrice,
      exitPrice,
      leverage,
    },
  };
}

function mergeTradingViewData(
  data: TradingViewKlineDataInput | undefined,
  trade: ProjectTrade
): TradingViewKlineDataInput {
  const window = resolveKlineWindow(trade);
  const pair = trade.pair || `${trade.symbol.replace(/[^A-Za-z0-9]/g, "")}USDT`;
  const timeframe =
    data?.timeframe ||
    trade.timeframe ||
    (window ? intervalToTimeframeLabel(window.interval) : "1小时");

  const entryPrice = coercePrice(trade.entry.price);
  const tpPrice =
    coercePrice(trade.takeProfit?.price) ?? coercePrice(trade.exitPrice);

  // 止盈/止损线保留 JSON 百分比配置，等 K 线就绪后在 resolveTradeSignal 里按开仓/止盈价解析
  return {
    ...data,
    symbol: data?.symbol || trade.symbolLabel || trade.symbol,
    timeframe,
    dynamic: window
      ? {
          source: window.source ?? "binance",
          symbol: pair,
          interval: window.interval,
          start: window.start,
          end: window.end,
          warmupBars: window.warmupBars,
        }
      : data?.dynamic,
    signals: {
      side: trade.side ?? "long",
      entry: {
        time: trade.entry.time,
        price: entryPrice,
        label: trade.entry.label ?? "上车点",
      },
      takeProfit: trade.takeProfit
        ? {
            time: trade.takeProfit.time,
            price: tpPrice,
            label: trade.takeProfit.label ?? "止盈点",
          }
        : undefined,
      takeProfitLine: trade.takeProfitLine,
      stopLossLine: trade.stopLossLine,
      settlement: {
        label: trade.settlementLabel ?? "结算",
        notional: trade.notional ?? trade.entryValue ?? 10_000,
        holdSeconds: trade.settlementHoldSeconds ?? 5,
        returnPercent: trade.returnPercent,
        profit: trade.profit,
        exitPrice: trade.exitPrice ?? tpPrice,
      },
    },
  };
}

function mergeLayer(layer: TimelineLayer, trade: ProjectTrade): TimelineLayer {
  if (layer.type === "pnl_cover") {
    return mergePnlCover(layer, trade);
  }
  if (layer.type === "echart_panel" && layer.props.tradingViewStyle) {
    return {
      ...layer,
      props: {
        ...layer.props,
        tradingViewData: mergeTradingViewData(layer.props.tradingViewData, trade),
      },
    };
  }
  return layer;
}

/** 规范化 trade.kline（周期别名 + 缺省起止外扩），并注入 timeline */
export function applyProjectTrade(project: VideoProject): VideoProject {
  const trade = project.trade;
  if (!trade?.symbol || !trade.entry?.time) return project;

  const window = resolveKlineWindow(trade);
  const normalizedTrade: ProjectTrade = {
    ...trade,
    leverage: trade.leverage != null && trade.leverage > 0 ? trade.leverage : 20,
    timeframe:
      trade.timeframe ||
      (window ? intervalToTimeframeLabel(window.interval) : trade.timeframe),
    kline: window
      ? {
          source: window.source ?? "binance",
          interval: window.interval,
          start: window.start,
          end: window.end,
          warmupBars: window.warmupBars,
          padRatio: trade.kline?.padRatio ?? 0.2,
        }
      : trade.kline,
  };

  return {
    ...project,
    trade: normalizedTrade,
    timeline: project.timeline.map((layer) => mergeLayer(layer, normalizedTrade)),
  };
}
