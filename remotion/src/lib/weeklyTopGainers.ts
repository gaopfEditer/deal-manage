/**
 * 扫描合约/现货：近七日按自然日涨幅排序，取每日前三，合并为组合。
 * 合约源优先 Binance FAPI → Bybit → Binance 现货回退。
 */

import { newAssetLeg, type AssetLeg, type AssetSourceKind } from "./priceSource";
import { fetchBybitDailyBars, fetchBybitTopLinearUsdtPairs } from "./bybitDaily";

const BINANCE = "/binance";
const BINANCE_FAPI = "/binance-fapi";

/** 海外域名易超时：单请求上限，超时立刻换源 */
const FETCH_MS = 6_000;

function fetchTimed(url: string, ms = FETCH_MS): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(ms) });
}

/** 涨幅榜组合图表 K 线粒度（扫描仍用日线） */
export const TOP_GAINER_CHART_INTERVAL = "1h";

export type WeekScope = "last-7-days" | "this-week" | "last-week" | "both";

export const WEEK_SCOPE_OPTIONS: { id: WeekScope; label: string }[] = [
  { id: "last-7-days", label: "近七天" },
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

/** 现货妖币回退时排除的大盘 */
const MAJOR_BASES = new Set([
  "BTC",
  "ETH",
  "BNB",
  "SOL",
  "XRP",
  "DOGE",
  "ADA",
  "TRX",
  "TON",
  "AVAX",
  "LINK",
  "DOT",
  "MATIC",
  "POL",
  "LTC",
  "BCH",
  "SHIB",
  "PEPE",
  "WIF",
  "SUI",
  "APT",
  "NEAR",
  "ATOM",
  "UNI",
  "AAVE",
]);

export type WeeklyTopGainerCombo = {
  legs: AssetLeg[];
  startDate: string;
  endDate: string;
  symbolCount: number;
  dayCount: number;
  dailyLeaders: Record<string, string[]>;
  metaLabel: string;
  /** 实际用的行情源（便于 toast 提示） */
  dataSource?: string;
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

export function mondayOfWeek(ref: Date = new Date()): Date {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return d;
}

export function last7DaysRange(ref: Date = new Date()): { start: string; end: string } {
  const end = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  return { start: fmtLocalYmd(start), end: fmtLocalYmd(end) };
}

export function weekRangeForScope(scope: WeekScope): { start: string; end: string } {
  if (scope === "last-7-days" || !scope) {
    return last7DaysRange();
  }

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
  if (pair.includes("_")) return true;
  return false;
}

async function fetchBinanceFapiPairs(limit: number): Promise<string[]> {
  const res = await fetchTimed(`${BINANCE_FAPI}/fapi/v1/ticker/24hr`, 5_000);
  if (!res.ok) throw new Error(`Binance 合约 ticker 失败 ${res.status}`);
  const rows = (await res.json()) as Array<{ symbol: string; quoteVolume: string }>;
  if (!Array.isArray(rows)) throw new Error("Binance 合约 ticker 返回异常");
  return rows
    .filter((r) => r.symbol.endsWith("USDT") && !isExcludedPair(r.symbol))
    .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, limit)
    .map((r) => r.symbol);
}

async function fetchBinanceSpotPairs(limit: number): Promise<string[]> {
  const res = await fetchTimed(`${BINANCE}/api/v3/ticker/24hr`);
  if (!res.ok) throw new Error(`Binance 现货 ticker 失败 ${res.status}`);
  const rows = (await res.json()) as Array<{ symbol: string; quoteVolume: string }>;
  if (!Array.isArray(rows)) throw new Error("Binance 现货 ticker 返回异常");
  return rows
    .filter((r) => r.symbol.endsWith("USDT") && !isExcludedPair(r.symbol))
    .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, limit)
    .map((r) => r.symbol);
}

/** 现货「妖币」池：跳过大盘前 40，取其后 120 个成交额对 */
export async function fetchBinanceSpotMicrocapPairs(limit = 120): Promise<string[]> {
  const res = await fetchTimed(`${BINANCE}/api/v3/ticker/24hr`);
  if (!res.ok) throw new Error(`Binance 现货 ticker 失败 ${res.status}`);
  const rows = (await res.json()) as Array<{ symbol: string; quoteVolume: string }>;
  if (!Array.isArray(rows)) throw new Error("Binance 现货 ticker 返回异常");

  return rows
    .filter(
      (r) =>
        r.symbol.endsWith("USDT") &&
        !isExcludedPair(r.symbol) &&
        !MAJOR_BASES.has(baseFromPair(r.symbol))
    )
    .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(40, 40 + limit)
    .map((r) => r.symbol);
}

async function fetchBinanceFapiDailyBars(
  pair: string,
  startDate: string,
  endDate: string
): Promise<DayBar[]> {
  const startMs = Date.parse(`${startDate}T00:00:00`);
  const endMs = Date.parse(`${endDate}T23:59:59`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];
  const url =
    `${BINANCE_FAPI}/fapi/v1/klines?symbol=${encodeURIComponent(pair)}` +
    `&interval=1d&startTime=${startMs}&endTime=${endMs}&limit=1000`;
  try {
    const res = await fetchTimed(url, 5_000);
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
      out.push({ date: fmtLocalYmd(new Date(openTime)), open, close });
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchBinanceSpotDailyBars(
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
  const res = await fetchTimed(url);
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
    out.push({ date: fmtLocalYmd(new Date(openTime)), open, close });
  }
  return out;
}

export type MarketFeedKind = "binance-futures" | "bybit" | "binance";

type ResolvedFeed = {
  kind: MarketFeedKind;
  label: string;
  pairs: string[];
  fetchDailyBars: (pair: string, start: string, end: string) => Promise<DayBar[]>;
};

/** 合约扫描源：Bybit → 现货 → Binance FAPI（国内 FAPI 常超时，放最后且短超时） */
async function resolveFuturesFeed(limit = 120): Promise<ResolvedFeed> {
  const errors: string[] = [];

  try {
    const pairs = await fetchBybitTopLinearUsdtPairs(limit);
    if (pairs.length) {
      return {
        kind: "bybit",
        label: "Bybit合约",
        pairs,
        fetchDailyBars: fetchBybitDailyBars,
      };
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  try {
    const pairs = await fetchBinanceSpotPairs(limit);
    if (pairs.length) {
      return {
        kind: "binance",
        label: "Binance现货(回退)",
        pairs,
        fetchDailyBars: fetchBinanceSpotDailyBars,
      };
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  try {
    const pairs = await fetchBinanceFapiPairs(limit);
    if (pairs.length) {
      return {
        kind: "binance-futures",
        label: "Binance合约",
        pairs,
        fetchDailyBars: fetchBinanceFapiDailyBars,
      };
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  throw new Error(`合约行情源均不可用：${errors.join("；") || "未知错误"}`);
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
  dataSource?: string;
};

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
    dataSource: opts.dataSource,
  };
}

function sourceForFeed(kind: MarketFeedKind): AssetSourceKind {
  if (kind === "binance-futures") return "binance-futures";
  if (kind === "bybit") return "bybit";
  return "binance";
}

/**
 * 近七日合约每日涨幅前三（自动换源重试）。
 */
export async function buildWeeklyTopGainerCombo(
  scope: WeekScope = "last-7-days"
): Promise<WeeklyTopGainerCombo> {
  const feed = await resolveFuturesFeed(120);
  return buildTopGainerComboFromPairs({
    scope,
    metaPrefix: "合约每日涨幅前三",
    pairs: feed.pairs,
    pairToBase: baseFromPair,
    fetchDailyBars: feed.fetchDailyBars,
    dataSource: feed.label,
    makeLeg: (base) =>
      newAssetLeg({
        source: sourceForFeed(feed.kind),
        symbol: base,
        label: base,
        interval: TOP_GAINER_CHART_INTERVAL,
      }),
  });
}

/** Alpha 不可用时：现货妖币池每日涨幅前三 */
export async function buildSpotMicrocapTopGainerCombo(
  scope: WeekScope = "last-7-days"
): Promise<WeeklyTopGainerCombo> {
  const pairs = await fetchBinanceSpotMicrocapPairs(120);
  if (!pairs.length) throw new Error("现货妖币候选为空");
  return buildTopGainerComboFromPairs({
    scope,
    metaPrefix: "现货妖币每日涨幅前三",
    pairs,
    pairToBase: baseFromPair,
    fetchDailyBars: fetchBinanceSpotDailyBars,
    dataSource: "Binance现货妖币(Alpha回退)",
    makeLeg: (base) =>
      newAssetLeg({
        source: "binance",
        symbol: base,
        label: base,
        interval: TOP_GAINER_CHART_INTERVAL,
      }),
  });
}

export function describeWeekRange(scope: WeekScope = "last-7-days"): string {
  const { start, end } = weekRangeForScope(scope);
  return `${start} → ${end}`;
}
