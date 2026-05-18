import type {
  KlineCallout,
  TradingViewKlineBar,
  TradingViewKlineDataInput,
} from "../../lib/types";
import type { OhlcTuple } from "./echartKlineHelpers";

export type { KlineCallout };

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
  showLastPriceArrow: boolean;
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

function resolveCallouts(
  raw: TradingViewKlineDataInput["callouts"]
): KlineCallout[] {
  if (!raw?.length) return [];
  return raw.map((c) => {
    const paletteKey = c.palette as CalloutPaletteKey | undefined;
    const fromPalette =
      paletteKey && paletteKey in CALLOUT_PALETTE ? CALLOUT_PALETTE[paletteKey] : null;
    return {
      index: c.index,
      text: c.text,
      color: c.color ?? fromPalette?.bg,
      textColor: c.textColor ?? fromPalette?.fg,
      direction: c.direction,
    };
  });
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
    const extra = resolveCallouts(input.callouts);
    for (const c of extra) {
      if (!callouts.some((x) => x.index === c.index && x.text === c.text)) {
        callouts.push(c);
      }
    }
  } else {
    if (!input.ohlc?.length) {
      throw new Error("tradingViewData 需提供 bars 或 ohlc");
    }
    ohlc = parseOhlcRows(input.ohlc);
    volumes = input.volumes ?? [];
    vegas144 = input.vegas144 ?? [];
    vegas169 = input.vegas169 ?? [];
    categories =
      input.categories?.length === ohlc.length
        ? input.categories
        : Array.from({ length: ohlc.length }, (_, i) => String(i + 1));
    callouts = resolveCallouts(input.callouts);
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
    showLastPriceArrow: input.showLastPriceArrow !== false,
    ...stats,
  };
}
