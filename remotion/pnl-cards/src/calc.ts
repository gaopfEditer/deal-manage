export function calcPnlPct(
  side: "long" | "short",
  entry: number,
  exit: number,
  leverage: number
): number {
  if (!entry) return 0;
  const move =
    side === "long" ? (exit - entry) / entry : (entry - exit) / entry;
  return move * leverage * 100;
}

export function formatPnl(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function formatPrice(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "";
  return n.toFixed(4);
}

/** 价格展示：千分位 + 2 位小数（如 2,665.73） */
export function formatPriceDisplay(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "";
  const digits = Math.abs(n) >= 1 ? 2 : 4;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: Math.min(2, digits),
    maximumFractionDigits: digits,
  });
}
