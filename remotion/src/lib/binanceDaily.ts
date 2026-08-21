/** Binance K 线（经 Vite 代理，避免浏览器 CORS） */

import { INTERVAL_MS, normalizeBinanceInterval } from "./klineTime";

const DAY = 86_400_000;

export type DailyPoint = { date: string; close: number };

function fmtLocalAxisLabel(ts: number, interval: string): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  if (interval === "1d") return `${y}-${m}-${day}`;
  const h = String(d.getHours()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:00`;
}

function fmtUTC(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function toSymbolPair(symbol: string): string {
  const s = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!s) return "";
  if (s.endsWith("USDT") || s.endsWith("BUSD") || s.endsWith("USD")) return s;
  return `${s}USDT`;
}

/**
 * 拉取单币种 K 线收盘价（支持 1h / 1d 等）。
 * 开发环境走 `/binance/...` 代理。
 */
export async function fetchBinanceKlineCloses(
  symbol: string,
  startDate: string,
  endDate: string,
  intervalRaw = "1d"
): Promise<DailyPoint[]> {
  const interval = normalizeBinanceInterval(intervalRaw);
  const pair = toSymbolPair(symbol);
  if (!pair) return [];

  const startMs =
    interval === "1d"
      ? Date.parse(`${startDate}T00:00:00Z`)
      : Date.parse(`${startDate}T00:00:00`);
  const endMs =
    interval === "1d"
      ? Date.parse(`${endDate}T23:59:59Z`)
      : Date.parse(`${endDate}T23:59:59`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
    throw new Error(`日期无效: ${startDate} → ${endDate}`);
  }

  const step = INTERVAL_MS[interval] ?? DAY;
  const out: DailyPoint[] = [];
  let cursor = startMs;
  let guard = 0;
  const maxPages = interval === "1d" ? 40 : 200;

  while (cursor <= endMs && guard < maxPages) {
    guard += 1;
    const url =
      `/binance/api/v3/klines?symbol=${encodeURIComponent(pair)}` +
      `&interval=${encodeURIComponent(interval)}&startTime=${cursor}&endTime=${endMs}&limit=1000`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${pair} 请求失败 ${res.status}: ${text.slice(0, 120)}`);
    }
    const rows = (await res.json()) as unknown[];
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 5) continue;
      const openTime = Number(row[0]);
      const close = Number(row[4]);
      if (!Number.isFinite(openTime) || !Number.isFinite(close)) continue;
      const date =
        interval === "1d" ? fmtUTC(openTime) : fmtLocalAxisLabel(openTime, interval);
      out.push({ date, close });
    }
    const lastOpen = Number((rows[rows.length - 1] as unknown[])[0]);
    if (!Number.isFinite(lastOpen)) break;
    const next = lastOpen + step;
    if (next <= cursor) break;
    cursor = next;
    if (rows.length < 1000) break;
  }

  const map = new Map<string, number>();
  for (const p of out) map.set(p.date, p.close);
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, close]) => ({ date, close }));
}

/**
 * 拉取单币种日线收盘价（UTC 日期轴，与新浪/Gate 对齐）。
 */
export async function fetchBinanceDailyCloses(
  symbol: string,
  startDate: string,
  endDate: string
): Promise<DailyPoint[]> {
  return fetchBinanceKlineCloses(symbol, startDate, endDate, "1d");
}

/**
 * USDT-M 永续合约 K 线（经 /binance → data-api.binance.vision/fapi）。
 */
export async function fetchBinanceFuturesKlineCloses(
  symbol: string,
  startDate: string,
  endDate: string,
  intervalRaw = "1d"
): Promise<DailyPoint[]> {
  const interval = normalizeBinanceInterval(intervalRaw);
  const pair = toSymbolPair(symbol);
  if (!pair) return [];

  const startMs =
    interval === "1d"
      ? Date.parse(`${startDate}T00:00:00Z`)
      : Date.parse(`${startDate}T00:00:00`);
  const endMs =
    interval === "1d"
      ? Date.parse(`${endDate}T23:59:59Z`)
      : Date.parse(`${endDate}T23:59:59`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
    throw new Error(`日期无效: ${startDate} → ${endDate}`);
  }

  const step = INTERVAL_MS[interval] ?? DAY;
  const out: DailyPoint[] = [];
  let cursor = startMs;
  let guard = 0;
  const maxPages = interval === "1d" ? 40 : 200;

  while (cursor <= endMs && guard < maxPages) {
    guard += 1;
    const url =
      `/binance-fapi/fapi/v1/klines?symbol=${encodeURIComponent(pair)}` +
      `&interval=${encodeURIComponent(interval)}&startTime=${cursor}&endTime=${endMs}&limit=1500`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${pair} 合约请求失败 ${res.status}: ${text.slice(0, 120)}`);
    }
    const rows = (await res.json()) as unknown[];
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 5) continue;
      const openTime = Number(row[0]);
      const close = Number(row[4]);
      if (!Number.isFinite(openTime) || !Number.isFinite(close)) continue;
      const date =
        interval === "1d" ? fmtUTC(openTime) : fmtLocalAxisLabel(openTime, interval);
      out.push({ date, close });
    }
    const lastOpen = Number((rows[rows.length - 1] as unknown[])[0]);
    if (!Number.isFinite(lastOpen)) break;
    const next = lastOpen + step;
    if (next <= cursor) break;
    cursor = next;
    if (rows.length < 1000) break;
  }

  const map = new Map<string, number>();
  for (const p of out) map.set(p.date, p.close);
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, close]) => ({ date, close }));
}

export async function fetchMultiSymbolDaily(
  symbols: string[],
  startDate: string,
  endDate: string
): Promise<{ dates: string[]; series: Record<string, (number | null)[]> }> {
  const results = await Promise.all(
    symbols.map(async (sym) => {
      const points = await fetchBinanceDailyCloses(sym, startDate, endDate);
      return { sym: sym.trim().toUpperCase(), points };
    })
  );

  const dateSet = new Set<string>();
  for (const r of results) for (const p of r.points) dateSet.add(p.date);
  const dates = [...dateSet].sort();

  const series: Record<string, (number | null)[]> = {};
  for (const r of results) {
    const m = new Map(r.points.map((p) => [p.date, p.close]));
    series[r.sym] = dates.map((d) => (m.has(d) ? (m.get(d) as number) : null));
  }
  return { dates, series };
}
