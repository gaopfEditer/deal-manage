/** 运营工具演示数据（可后续换成真实 API） */

const DAY = 86_400_000;

export function seededRand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export type HoldSeries = {
  dates: string[];
  series: Record<string, number[]>;
  initialCapital: number;
  symbols: string[];
};

export function buildHoldSeries(opts: {
  symbols?: string[];
  startDate?: string;
  initialCapital?: number;
  seed?: number;
} = {}): HoldSeries {
  const symbols = opts.symbols ?? ["BTC", "ETH", "SOL", "BNB"];
  const startDate = opts.startDate ?? "2013-01-01";
  const initialCapital = opts.initialCapital ?? 1_000_000;
  const rand = seededRand(opts.seed ?? 42);
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate()
  );
  const baseMul: Record<string, number> = {
    BTC: 1.00055,
    ETH: 1.00048,
    SOL: 1.00072,
    BNB: 1.0005,
    DOGE: 1.0004,
  };
  const startPx: Record<string, number> = {
    BTC: 13,
    ETH: 0.7,
    SOL: 0.5,
    BNB: 0.1,
    DOGE: 0.0002,
  };

  const dates: string[] = [];
  for (let t = start; t <= end; t += DAY) {
    const d = new Date(t);
    dates.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
    );
  }

  const series: Record<string, number[]> = {};
  for (const sym of symbols) {
    let px = startPx[sym] ?? 1 + rand() * 10;
    const mul = baseMul[sym] ?? 1.00045;
    const values: number[] = [];
    const base = startPx[sym] ?? px;
    for (let i = 0; i < dates.length; i++) {
      px *= mul * (1 + (rand() - 0.48) * 0.04);
      px = Math.max(px, 1e-8);
      values.push((initialCapital * px) / base);
    }
    series[sym] = values;
  }
  return { dates, series, initialCapital, symbols };
}

export type RaceFrame = {
  date: string;
  ranking: { name: string; value: number }[];
};

export function buildRaceFrames(hold: HoldSeries, stepDays = 30): RaceFrame[] {
  const { dates, series, symbols } = hold;
  const frames: RaceFrame[] = [];
  for (let i = 0; i < dates.length; i += stepDays) {
    frames.push({
      date: dates[i],
      ranking: symbols
        .map((sym) => ({ name: sym, value: series[sym][i] }))
        .sort((a, b) => b.value - a.value),
    });
  }
  const last = dates.length - 1;
  if (!frames.length || frames[frames.length - 1].date !== dates[last]) {
    frames.push({
      date: dates[last],
      ranking: symbols
        .map((sym) => ({ name: sym, value: series[sym][last] }))
        .sort((a, b) => b.value - a.value),
    });
  }
  return frames;
}

export function buildLiquidationHeatmap(opts: {
  days?: number;
  buckets?: number;
  seed?: number;
} = {}) {
  const days = opts.days ?? 90;
  const buckets = opts.buckets ?? 24;
  const rand = seededRand(opts.seed ?? 7);
  const now = Date.now();
  const xLabels: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * DAY);
    xLabels.push(`${d.getMonth() + 1}/${d.getDate()}`);
  }
  const yLabels: string[] = [];
  const mid = 70000;
  for (let b = 0; b < buckets; b++) {
    const p = mid - 15000 + (b / (buckets - 1)) * 30000;
    yLabels.push(`${Math.round(p / 1000)}k`);
  }
  const data: [number, number, number][] = [];
  for (let x = 0; x < days; x++) {
    for (let y = 0; y < buckets; y++) {
      const dist = Math.abs(y - buckets * 0.55);
      const spike = x > days * 0.7 && dist < 3 ? 1.8 : 1;
      const v = Math.max(0, (rand() * 40 + (8 - dist) * 6) * spike);
      data.push([x, y, Math.round(v)]);
    }
  }
  return { xLabels, yLabels, data, days };
}

export function buildStrategyDuel(hold: HoldSeries, symbol = "BTC") {
  const prices = hold.series[symbol];
  const dates = hold.dates;
  const initial = hold.initialCapital;
  const startPx = prices[0];
  const buyHold = prices.map((p) => (initial * p) / startPx);
  let cash = 0;
  let units = initial / startPx;
  const strategy: number[] = [];
  const window = 60;
  for (let i = 0; i < prices.length; i++) {
    const px = prices[i];
    if (i >= window) {
      const ma = prices.slice(i - window, i).reduce((a, b) => a + b, 0) / window;
      if (px < ma * 0.92 && units > 0) {
        cash += units * px * 0.5;
        units *= 0.5;
      } else if (px > ma * 1.05 && cash > 0) {
        units += cash / px;
        cash = 0;
      }
    }
    strategy.push(cash + units * px);
  }
  return { dates, buyHold, strategy, symbol, initial };
}

export function formatMoney(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  return `${Math.round(n)}`;
}
