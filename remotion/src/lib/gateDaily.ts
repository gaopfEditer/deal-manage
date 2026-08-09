/**
 * Gate.io 现货日线（经 Vite `/gate` 代理）。
 * BTC_USDT 约自 2013-03 起有数据，早于 Binance 现货 2017-08。
 */

import type { DailyPoint } from "./binanceDaily";

const DAY_SEC = 86_400;
/** 单次最多约 1000 根，按 ~900 天分窗 */
const CHUNK_DAYS = 900;

function toGatePair(symbol: string): string {
  const s = symbol.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "");
  if (!s) return "";
  if (s.includes("_")) return s;
  if (s.endsWith("USDT") || s.endsWith("USD")) {
    const base = s.replace(/USDT$|USD$/, "");
    return `${base}_USDT`;
  }
  return `${s}_USDT`;
}

function ymdToSec(ymd: string): number {
  return Math.floor(Date.parse(`${ymd}T00:00:00Z`) / 1000);
}

function secToYmd(sec: number): string {
  const d = new Date(sec * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * 拉取 Gate 日线收盘价，自动按时间窗分段直到覆盖起止日期。
 * 返回行：[timestamp, volume, close, high, low, open, ...]
 */
export async function fetchGateDailyCloses(
  symbol: string,
  startDate: string,
  endDate: string
): Promise<DailyPoint[]> {
  const pair = toGatePair(symbol);
  if (!pair) return [];

  let from = ymdToSec(startDate);
  const endSec = ymdToSec(endDate) + DAY_SEC - 1;
  if (!Number.isFinite(from) || !Number.isFinite(endSec) || from > endSec) {
    throw new Error(`日期无效: ${startDate} → ${endDate}`);
  }

  const map = new Map<string, number>();
  let guard = 0;

  while (from <= endSec && guard < 40) {
    guard += 1;
    const to = Math.min(endSec, from + CHUNK_DAYS * DAY_SEC);
    const url =
      `/gate/api/v4/spot/candlesticks?currency_pair=${encodeURIComponent(pair)}` +
      `&interval=1d&from=${from}&to=${to}`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${pair} Gate 请求失败 ${res.status}: ${text.slice(0, 120)}`);
    }
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) {
      const msg =
        rows && typeof rows === "object" && "message" in rows
          ? String((rows as { message: string }).message)
          : "返回异常";
      throw new Error(`${pair} Gate: ${msg}`);
    }
    if (rows.length === 0) {
      from = to + 1;
      continue;
    }
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 3) continue;
      const ts = Number(row[0]);
      const close = Number(row[2]);
      if (!Number.isFinite(ts) || !Number.isFinite(close)) continue;
      const date = secToYmd(ts);
      if (date < startDate || date > endDate) continue;
      map.set(date, close);
    }
    from = to + 1;
  }

  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, close]) => ({ date, close }));
}
