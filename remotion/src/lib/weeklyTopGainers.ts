/**
 * 扫描 Binance USDT 现货：按自然日涨幅排序，取每日前三，合并为组合。
 */

import { newAssetLeg, type AssetLeg } from "./priceSource";

const BINANCE = "/binance";

/** 涨幅榜组合图表 K 线粒度（扫描仍用日线） */
export const TOP_GAINER_CHART_INTERVAL = "1h";

export type WeekScope = "this-week" | "last-week" | "both";

export const WEEK_SCOPE_OPTIONS: { id: WeekScope; label: string }[] = [
  { id: "this-week", label: "本周" },
  { id: "last-week", label: "上周" },
  { id: "both", label: "本周+上周" },
];

const STABLE_BASES = new Set([
  "USDT",
  "USDC",
  "FDUSD",
  "TUSD",
  "DAI",
  "USDP",
  "EUR",
  "AEUR",
  "USD1",
  "USDE",
]);

export type WeeklyTopGainerCombo = {
  legs: AssetLeg[];
  startDate: string;
  endDate: string;
  symbolCount: number;
  dayCount: number;
  dailyLeaders: Record<string, string[]>;
  metaLabel: string;
};

export type DayBar = { date: string; open: number; close: number };

function fmtLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseYmdLocal(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** 周一为一周起点（本地时区） */
export function mondayOfWeek(ref: Date = new Date()): Date {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return d;
}

export function weekRangeForScope(scope: WeekScope): { start: string; end: string } {
  const today = new Date();
  const thisMon = mondayOfWeek(today);
  const thisSun = new Date(thisMon);
  thisSun.setDate(thisSun.getDate() + 6);
  const lastMon = new Date(thisMon);
  lastMon.setDate(lastMon.getDate() - 7);
  const lastSun = new Date(lastMon);
  lastSun.setDate(lastSun.getDate() + 6);

  const endThis = today < thisSun ? today : thisSun;

  if (scope === "this-week") {
    return { start: fmtLocalYmd(thisMon), end: fmtLocalYmd(endThis) };
  }
  if (scope === "last-week") {
    return { start: fmtLocalYmd(lastMon), end: fmtLocalYmd(lastSun) };
  }
  return { start: fmtLocalYmd(lastMon), end: fmtLocalYmd(endThis) };
}

function listDatesInclusive(start: string, end: string): string[] {
  const out: string[] = [];
  const cur = parseYmdLocal(start);
  const endD = parseYmdLocal(end);
  while (cur <= endD) {
    out.push(fmtLocalYmd(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function baseFromPair(pair: string): string {
  return pair.endsWith("USDT") ? pair.slice(0, -4) : pair;
}

function isExcludedPair(pair: string): boolean {
  const base = baseFromPair(pair);
  if (STABLE_BASES.has(base)) return true;
  if (/^(LD|LA)/.test(base)) return true;
  if (/UP$|DOWN$|BEAR$|BULL$/.test(base) && base.length > 5) return true;
  return false;
}

async function fetchTopVolumeUsdtPairs(limit = 120): Promise<string[]> {
  const res = await fetch(`${BINANCE}/api/v3/ticker/24hr`);
  if (!res.ok) throw new Error(`Binance ticker 失败 ${res.status}`);
  const rows = (await res.json()) as Array<{
    symbol: string;
    quoteVolume: string;
  }>;
  if (!Array.isArray(rows)) throw new Error("Binance ticker 返回异常");

  return rows
    .filter((r) => r.symbol.endsWith("USDT") && !isExcludedPair(r.symbol))
    .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, limit)
    .map((r) => r.symbol);
}

async function fetchDailyBars(
  pair: string,
  startDate: string,
  endDate: string
): Promise<DayBar[]> {
  const startMs = Date.parse(`${startDate}T00:00:00`);
  const endMs = Date.parse(`${endDate}T23:59:59`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];

  const url =
    `${BINANCE}/api/v3/klines?symbol=${encodeURIComponent(pair)}` +
    `&interval=1d&startTime=${startMs}&endTime=${endMs}&limit=1000`;
  const res = await fetch(url);
  if (!res.ok) return [];

  const rows = (await res.json()) as unknown[];
  if (!Array.isArray(rows)) return [];

  const out: DayBar[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const openTime = Number(row[0]);
    const open = Number(row[1]);
    const close = Number(row[4]);
    if (!Number.isFinite(openTime) || !Number.isFinite(open) || !Number.isFinite(close)) continue;
    const d = new Date(openTime);
    out.push({
      date: fmtLocalYmd(d),
      open,
      close,
    });
  }
  return out;
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export type TopGainerBuildOptions = {
  scope: WeekScope;
  metaPrefix: string;
  pairs: string[];
  pairToBase: (pair: string) => string;
  fetchDailyBars: (pair: string, scanStart: string, end: string) => Promise<DayBar[]>;
  makeLeg: (base: string, pair: string) => AssetLeg;
  concurrency?: number;
};

/** 在给定交易对集合内，按日涨幅取前三并合并为组合 */
export async function buildTopGainerComboFromPairs(
  opts: TopGainerBuildOptions
): Promise<WeeklyTopGainerCombo> {
  const { start, end } = weekRangeForScope(opts.scope);
  const targetDates = new Set(listDatesInclusive(start, end));
  const scanStart = fmtLocalYmd(
    (() => {
      const d = parseYmdLocal(start);
      d.setDate(d.getDate() - 3);
      return d;
    })()
  );

  const pairs = opts.pairs.filter(Boolean);
  if (!pairs.length) throw new Error("候选交易对为空");

  const byDateBase = new Map<string, Map<string, number>>();

  await mapPool(pairs, opts.concurrency ?? 8, async (pair) => {
    const bars = await opts.fetchDailyBars(pair, scanStart, end);
    if (bars.length < 2) return;
    const base = opts.pairToBase(pair);
    bars.sort((a, b) => (a.date < b.date ? -1 : 1));

    for (let i = 1; i < bars.length; i++) {
      const date = bars[i].date;
      if (!targetDates.has(date)) continue;
      const prev = bars[i - 1].close;
      const close = bars[i].close;
      if (prev <= 0 || close <= 0) continue;
      const pct = ((close - prev) / prev) * 100;
      if (!byDateBase.has(date)) byDateBase.set(date, new Map());
      byDateBase.get(date)!.set(base, pct);
    }
  });

  const dailyLeaders: Record<string, string[]> = {};
  const symbolSet = new Set<string>();

  for (const date of [...targetDates].sort()) {
    const m = byDateBase.get(date);
    if (!m?.size) continue;
    const top3 = [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([base]) => base);
    if (!top3.length) continue;
    dailyLeaders[date] = top3;
    for (const s of top3) symbolSet.add(s);
  }

  if (!symbolSet.size) {
    throw new Error(`${start} → ${end} 内未算出涨幅榜，请稍后重试或换时间范围`);
  }

  const pairByBase = new Map(pairs.map((p) => [opts.pairToBase(p), p]));
  const legs = [...symbolSet]
    .sort()
    .map((base) => opts.makeLeg(base, pairByBase.get(base) ?? base));

  const scopeLabel = WEEK_SCOPE_OPTIONS.find((o) => o.id === opts.scope)?.label ?? opts.scope;
  return {
    legs,
    startDate: start,
    endDate: end,
    symbolCount: legs.length,
    dayCount: Object.keys(dailyLeaders).length,
    dailyLeaders,
    metaLabel: `${opts.metaPrefix}·${scopeLabel}`,
  };
}

/**
 * 按 scope 扫描现货 USDT 每日涨幅前三，合并去重为 binance 资产腿。
 */
export async function buildWeeklyTopGainerCombo(
  scope: WeekScope
): Promise<WeeklyTopGainerCombo> {
  const pairs = await fetchTopVolumeUsdtPairs(120);
  if (!pairs.length) throw new Error("未获取到 USDT 交易对列表");

  return buildTopGainerComboFromPairs({
    scope,
    metaPrefix: "每日涨幅前三",
    pairs,
    pairToBase: baseFromPair,
    fetchDailyBars: fetchDailyBars,
    makeLeg: (base) =>
      newAssetLeg({
        source: "binance",
        symbol: base,
        label: base,
        interval: TOP_GAINER_CHART_INTERVAL,
      }),
  });
}

export function describeWeekRange(scope: WeekScope): string {
  const { start, end } = weekRangeForScope(scope);
  return `${start} → ${end}`;
}
