/** ECharts candlestick data项：[open, close, low, high] */
export type OhlcTuple = [number, number, number, number];

export function closesFromOhlc(rows: OhlcTuple[]): number[] {
  return rows.map((r) => r[1]);
}

/** 将请求周期压到可计算范围（K 根数太少时 EMA 仍要可算） */
export function clampEmaPeriod(requested: number, barCount: number): number {
  const maxP = Math.max(2, Math.floor(barCount * 0.48));
  return Math.max(2, Math.min(requested, maxP));
}

/** 经典 EMA：前 period-1 为 null，从 SMA 种子开始 */
export function computeEma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (values.length === 0 || period < 2) return out;
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (prev === null) {
      if (i === period - 1) {
        const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
        prev = seed;
        out[i] = seed;
      }
    } else {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

/**
 * 简易「射击之星」启发式：上影显著、实体小、位于局部高位附近。
 * 仅用于演示自动化；专业场景请用 indices 由上游量化引擎给出。
 */
export function detectShootingStarIndices(ohlc: OhlcTuple[]): number[] {
  const hits: number[] = [];
  for (let i = 2; i < ohlc.length - 1; i++) {
    const [open, close, low, high] = ohlc[i];
    const body = Math.abs(close - open);
    const range = high - low;
    if (range <= 0) continue;
    const upper = high - Math.max(open, close);
    const lower = Math.min(open, close) - low;
    const prevHigh = Math.max(ohlc[i - 1][3], ohlc[i - 2][3]);
    const localHigh = high >= prevHigh * 0.98;
    if (
      upper > body * 2.2 &&
      upper > lower * 1.4 &&
      body / range < 0.35 &&
      localHigh
    ) {
      hits.push(i);
    }
  }
  return hits;
}
