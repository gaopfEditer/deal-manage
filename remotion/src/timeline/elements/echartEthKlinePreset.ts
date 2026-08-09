import { parseTimeMs } from "../../lib/klineTime";
import { resolvePriceRef } from "../../lib/tradePriceRef";
import type {
  KlineCallout,
  TradingViewKlineBar,
  TradingViewKlineDataInput,
  TradingViewSignalPlanInput,
} from "../../lib/types";
import type { OhlcTuple } from "./echartKlineHelpers";

export type { KlineCallout };

/** 解析后的结算摘要 */
export type ResolvedSettlement = {
  label: string;
  entryValue: number;
  profit: number;
  returnPercent: number;
  exitPrice: number;
  /** 片尾停留秒数 */
  holdSeconds: number;
};

/** 解析后的发车信号（上车 / 止盈 / 止盈止损线 / 结算） */
export type ResolvedTradeSignal = {
  side: "long" | "short";
  entryIndex: number;
  entryPrice: number;
  entryLabel: string;
  takeProfitIndex?: number;
  takeProfitPrice?: number;
  takeProfitLabel?: string;
  takeProfitLine?: number;
  stopLossLine?: number;
  lineFromIndex: number;
  lineToIndex: number;
  settlement?: ResolvedSettlement;
};

export type EthTradingViewPreset = {
  symbol: string;
  timeframe: string;
  lastPrice: number;
  change: number;
  changePercent: number;
  vegasLegend: string;
  categories: string[];
  ohlc: OhlcTuple[];
  volumes: number[];
  vegas144: number[];
  vegas169: number[];
  callouts: KlineCallout[];
  signal?: ResolvedTradeSignal;
  showLastPriceArrow: boolean;
  /** 展示窗口前的收盘价，仅供布林预热，不渲染 */
  indicatorSeedCloses: number[];
};

export const CALLOUT_PALETTE = {
  red: { bg: "#ef4444", fg: "#fff" },
  green: { bg: "#22c55e", fg: "#fff" },
  cyan: { bg: "#0284c7", fg: "#fff" },
  orange: { bg: "#eab308", fg: "#1a1a1a" },
  purple: { bg: "#9333ea", fg: "#fff" },
  pink: { bg: "#f43f5e", fg: "#fff" },
} as const;

export type CalloutPaletteKey = keyof typeof CALLOUT_PALETTE;

function parseOhlcRows(rows: number[][]): OhlcTuple[] {
  return rows.map((row, i) => {
    if (!Array.isArray(row) || row.length < 4) {
      throw new Error(`tradingViewData.ohlc[${i}] 需为 [open, close, low, high]`);
    }
    const [open, close, low, high] = row;
    return [open, close, low, high] as OhlcTuple;
  });
}

/** 解析 kkkline.html 的 rawData 行 */
export function parseTradingViewBars(bars: TradingViewKlineBar[]): {
  categories: string[];
  ohlc: OhlcTuple[];
  volumes: number[];
  vegas144: number[];
  vegas169: number[];
  callouts: KlineCallout[];
} {
  const categories: string[] = [];
  const ohlc: OhlcTuple[] = [];
  const volumes: number[] = [];
  const vegas144: number[] = [];
  const vegas169: number[] = [];
  const callouts: KlineCallout[] = [];

  bars.forEach((row, index) => {
    if (!Array.isArray(row) || row.length < 8) {
      throw new Error(`tradingViewData.bars[${index}] 格式不完整`);
    }
    const [time, open, close, low, high, vol, v144, v169, signal, color, dir] = row;
    categories.push(String(time));
    ohlc.push([open, close, low, high]);
    volumes.push(vol);
    vegas144.push(v144);
    vegas169.push(v169);
    if (signal) {
      callouts.push({
        index,
        text: signal,
        color: color ?? undefined,
        direction: dir === "up" || dir === "down" ? dir : undefined,
      });
    }
  });

  return { categories, ohlc, volumes, vegas144, vegas169, callouts };
}

/** 用 time / index 定位到 categories 下标 */
export function resolveBarIndex(
  categories: string[],
  opts: { index?: number; time?: string }
): number {
  if (opts.index != null && Number.isFinite(opts.index)) {
    const i = Math.trunc(opts.index);
    if (i >= 0 && i < categories.length) return i;
  }
  const t = opts.time?.trim();
  if (!t) return -1;

  const exact = categories.findIndex((c) => c === t);
  if (exact >= 0) return exact;

  const includes = categories.findIndex((c) => c.includes(t) || t.includes(c));
  if (includes >= 0) return includes;

  const ms = parseTimeMs(t, false);
  if (Number.isFinite(ms)) {
    let best = -1;
    for (let i = 0; i < categories.length; i++) {
      const open = parseTimeMs(categories[i], false);
      if (Number.isFinite(open) && open <= ms) best = i;
      else if (Number.isFinite(open) && open > ms) break;
    }
    if (best >= 0) return best;
  }
  return -1;
}

function resolveCalloutItem(
  c: NonNullable<TradingViewKlineDataInput["callouts"]>[number],
  categories: string[],
  defaults?: { anchor?: "tip" | "bottom"; style?: "pin" | "arrow" }
): KlineCallout | null {
  const index = resolveBarIndex(categories, c);
  if (index < 0 || !c.text) return null;

  const paletteKey = c.palette as CalloutPaletteKey | undefined;
  const fromPalette =
    paletteKey && paletteKey in CALLOUT_PALETTE ? CALLOUT_PALETTE[paletteKey] : null;

  const anchor = c.anchor ?? defaults?.anchor;
  const direction =
    anchor === "tip" ? "up" : anchor === "bottom" ? "down" : c.direction;
  const style =
    c.style ??
    defaults?.style ??
    (anchor === "tip" || direction === "up" ? "arrow" : "pin");

  return {
    index,
    text: c.text,
    color: c.color ?? fromPalette?.bg,
    textColor: c.textColor ?? fromPalette?.fg,
    direction,
    anchor,
    style,
  };
}

function resolveCallouts(
  raw: TradingViewKlineDataInput["callouts"] | TradingViewKlineDataInput["arrows"],
  categories: string[],
  defaults?: { anchor?: "tip" | "bottom"; style?: "pin" | "arrow" }
): KlineCallout[] {
  if (!raw?.length) return [];
  const out: KlineCallout[] = [];
  for (const c of raw) {
    const item = resolveCalloutItem(c, categories, defaults);
    if (item) out.push(item);
  }
  return out;
}

function mergeCallouts(base: KlineCallout[], extra: KlineCallout[]): KlineCallout[] {
  const out = [...base];
  for (const c of extra) {
    if (!out.some((x) => x.index === c.index && x.text === c.text)) {
      out.push(c);
    }
  }
  return out;
}

function resolveLineIndex(
  categories: string[],
  ref: string | number | undefined,
  fallback: number
): number {
  if (ref == null) return fallback;
  if (typeof ref === "number") {
    const i = Math.trunc(ref);
    return i >= 0 && i < categories.length ? i : fallback;
  }
  const i = resolveBarIndex(categories, { time: ref });
  return i >= 0 ? i : fallback;
}

export function resolveTradeSignal(
  plan: TradingViewSignalPlanInput | undefined,
  categories: string[],
  ohlc: OhlcTuple[]
): ResolvedTradeSignal | undefined {
  if (!plan?.entry || !categories.length || !ohlc.length) return undefined;

  const entryIndex = resolveBarIndex(categories, plan.entry);
  if (entryIndex < 0) return undefined;

  const side = plan.side === "short" ? "short" : "long";
  const [, close] = ohlc[entryIndex];
  const entryPrice =
    plan.entry.price != null && Number.isFinite(plan.entry.price)
      ? plan.entry.price
      : close;

  let takeProfitIndex: number | undefined;
  let takeProfitPrice: number | undefined;
  if (plan.takeProfit) {
    const idx = resolveBarIndex(categories, plan.takeProfit);
    if (idx >= 0) {
      takeProfitIndex = idx;
      const [, tpClose] = ohlc[idx];
      takeProfitPrice =
        plan.takeProfit.price != null && Number.isFinite(plan.takeProfit.price)
          ? plan.takeProfit.price
          : tpClose;
    }
  }

  const bases = { entry: entryPrice, takeProfit: takeProfitPrice };
  // 默认都相对开仓价；JSON 可写 relativeTo: "takeProfit"
  // 未配置止盈线时，落到止盈点价格（画一条过止盈点的水平线）
  const takeProfitLine =
    resolvePriceRef(plan.takeProfitLine, bases, "entry") ?? takeProfitPrice;
  const stopLossLine = resolvePriceRef(plan.stopLossLine, bases, "entry");

  // 默认贯穿整段 K 线；仅当 JSON 显式给 lineFrom / lineTo 时收窄
  const lineFromIndex = resolveLineIndex(categories, plan.lineFrom, 0);
  const lineToIndex = resolveLineIndex(
    categories,
    plan.lineTo,
    categories.length - 1
  );

  const settlement = resolveSettlement(plan, {
    side,
    entryPrice,
    takeProfitPrice,
    takeProfitLine,
  });

  return {
    side,
    entryIndex,
    entryPrice,
    entryLabel: plan.entry.label?.trim() || "上车点",
    takeProfitIndex,
    takeProfitPrice,
    takeProfitLabel: plan.takeProfit?.label?.trim() || "止盈点",
    takeProfitLine,
    stopLossLine,
    lineFromIndex: Math.min(lineFromIndex, lineToIndex),
    lineToIndex: Math.max(lineFromIndex, lineToIndex),
    settlement,
  };
}

function resolveSettlement(
  plan: TradingViewSignalPlanInput,
  ctx: {
    side: "long" | "short";
    entryPrice: number;
    takeProfitPrice?: number;
    takeProfitLine?: number;
  }
): ResolvedSettlement | undefined {
  if (plan.settlement == null) return undefined;
  const cfg = plan.settlement === true ? {} : plan.settlement;

  const exitPrice =
    cfg.exitPrice ??
    ctx.takeProfitLine ??
    ctx.takeProfitPrice ??
    ctx.entryPrice;

  const priceReturn =
    ctx.entryPrice === 0
      ? 0
      : ctx.side === "long"
        ? ((exitPrice - ctx.entryPrice) / ctx.entryPrice) * 100
        : ((ctx.entryPrice - exitPrice) / ctx.entryPrice) * 100;

  const returnPercent =
    cfg.returnPercent != null && Number.isFinite(cfg.returnPercent)
      ? cfg.returnPercent
      : Math.round(priceReturn * 100) / 100;

  const entryValue =
    cfg.entryValue != null && Number.isFinite(cfg.entryValue)
      ? cfg.entryValue
      : cfg.notional != null && Number.isFinite(cfg.notional)
        ? cfg.notional
        : 10_000;

  const profit =
    cfg.profit != null && Number.isFinite(cfg.profit)
      ? cfg.profit
      : Math.round(entryValue * (returnPercent / 100) * 100) / 100;

  const holdSeconds =
    cfg.holdSeconds != null && Number.isFinite(cfg.holdSeconds) && cfg.holdSeconds > 0
      ? cfg.holdSeconds
      : 5;

  return {
    label: cfg.label?.trim() || "结算",
    entryValue,
    profit,
    returnPercent,
    exitPrice,
    holdSeconds,
  };
}

function computePriceStats(ohlc: OhlcTuple[]): {
  lastPrice: number;
  change: number;
  changePercent: number;
} {
  const last = ohlc[ohlc.length - 1];
  const prev = ohlc[ohlc.length - 2];
  const lastPrice = last[1];
  const prevClose = prev?.[1] ?? lastPrice;
  const change = Math.round((lastPrice - prevClose) * 100) / 100;
  const changePercent =
    prevClose === 0 ? 0 : Math.round((change / prevClose) * 10000) / 100;
  return { lastPrice, change, changePercent };
}

/**
 * 从 sample-project.json 的 tradingViewData 构建预设（支持 bars 或分拆字段）。
 */
export function buildTradingViewPresetFromData(
  input: TradingViewKlineDataInput
): EthTradingViewPreset {
  let categories: string[];
  let ohlc: OhlcTuple[];
  let volumes: number[];
  let vegas144: number[];
  let vegas169: number[];
  let callouts: KlineCallout[];

  if (input.bars?.length) {
    const parsed = parseTradingViewBars(input.bars);
    categories = parsed.categories;
    ohlc = parsed.ohlc;
    volumes = parsed.volumes;
    vegas144 = parsed.vegas144;
    vegas169 = parsed.vegas169;
    callouts = parsed.callouts;
  } else {
    if (!input.ohlc?.length) {
      throw new Error(
        "tradingViewData 需提供 bars、ohlc，或 dynamic（需经 calculateMetadata hydrate）"
      );
    }
    ohlc = parseOhlcRows(input.ohlc);
    volumes = input.volumes ?? [];
    vegas144 = input.vegas144 ?? [];
    vegas169 = input.vegas169 ?? [];
    categories =
      input.categories?.length === ohlc.length
        ? input.categories
        : Array.from({ length: ohlc.length }, (_, i) => String(i + 1));
    callouts = [];
    if (volumes.length && volumes.length !== ohlc.length) {
      throw new Error(
        `tradingViewData.volumes 长度(${volumes.length})须与 ohlc(${ohlc.length})一致`
      );
    }
    if (vegas144.length && vegas144.length !== ohlc.length) {
      throw new Error("tradingViewData.vegas144 长度须与 ohlc 一致");
    }
    if (vegas169.length && vegas169.length !== ohlc.length) {
      throw new Error("tradingViewData.vegas169 长度须与 ohlc 一致");
    }
  }

  callouts = mergeCallouts(
    callouts,
    resolveCallouts(input.callouts, categories)
  );
  callouts = mergeCallouts(
    callouts,
    resolveCallouts(input.arrows, categories, { anchor: "tip", style: "arrow" })
  );

  const signal = resolveTradeSignal(input.signals, categories, ohlc);

  const stats =
    input.lastPrice != null && input.change != null && input.changePercent != null
      ? {
          lastPrice: input.lastPrice,
          change: input.change,
          changePercent: input.changePercent,
        }
      : computePriceStats(ohlc);

  return {
    symbol: input.symbol,
    timeframe: input.timeframe,
    vegasLegend: input.vegasLegend ?? "Vegas 144 / 169",
    categories,
    ohlc,
    volumes: volumes.length ? volumes : ohlc.map(() => 50),
    vegas144,
    vegas169,
    callouts,
    signal,
    showLastPriceArrow: input.showLastPriceArrow !== false,
    indicatorSeedCloses: input.indicatorSeedCloses?.filter((n) => Number.isFinite(n)) ?? [],
    ...stats,
  };
}
