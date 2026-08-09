import type { TradingViewPriceRef, TradingViewPriceRelativeTo } from "./types";

/**
 * 将价格配置解析为绝对价。
 * - offsetPercent：相对基准价的涨跌幅，价 = base × (1 + pct/100)
 * - 止损 / 止盈线默认基准都是开仓价 entry（改百分比才会明显移动）
 * - 也可 `relativeTo: "takeProfit"` 相对止盈价
 */
export function resolvePriceRef(
  ref: TradingViewPriceRef | undefined,
  bases: { entry: number; takeProfit?: number },
  defaultRelativeTo: TradingViewPriceRelativeTo = "entry"
): number | undefined {
  if (ref == null) return undefined;
  if (typeof ref === "number") {
    return Number.isFinite(ref) ? ref : undefined;
  }
  if (ref.price != null && Number.isFinite(ref.price)) return ref.price;
  if (ref.offsetPercent != null && Number.isFinite(ref.offsetPercent)) {
    const which = ref.relativeTo ?? defaultRelativeTo;
    const base = which === "takeProfit" ? bases.takeProfit : bases.entry;
    if (base == null || !Number.isFinite(base) || base === 0) return undefined;
    return Math.round(base * (1 + ref.offsetPercent / 100) * 1e8) / 1e8;
  }
  return undefined;
}

/** 格式化线价标签（小币多位小数） */
export function formatLinePrice(price: number): string {
  if (!Number.isFinite(price)) return "";
  const abs = Math.abs(price);
  if (abs >= 1000) return price.toFixed(2);
  if (abs >= 1) return price.toFixed(4);
  if (abs >= 0.01) return price.toFixed(6);
  return price.toPrecision(4);
}
