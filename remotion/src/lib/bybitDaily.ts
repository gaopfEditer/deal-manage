/**
 * Bybit V5 行情（经 /bybit 代理）—— Binance 合约不可用时的备用源。
 * docs: https://bybit-exchange.github.io/docs/v5/market/tickers
 */

import { INTERVAL_MS, normalizeBinanceInterval } from "./klineTime";
import type { DailyPoint } from "./binanceDaily";

const BYBIT = "/bybit";

function fmtLocalAxisLabel(ts: number, interval: string): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  if (interval === "1d" || interval === "D") return `${y}-${m}-${day}`;
  const h = String(d.getHours()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:00`;
}

function toBybitInterval(intervalRaw: string): string {
  const n = normalizeBinanceInterval(intervalRaw);
  if (n === "1d") return "D";
  if (n === "1h") return "60";
  if (n === "4h") return "240";
  if (n.endsWith("m")) return n.replace("m", "");
  return "60";
}

function toUsdtPair(symbol: string): string {
  const s = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!s) return "";
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

/** linear USDT 永续：按成交额取前 N */
export async function fetchBybitTopLinearUsdtPairs(limit = 120): Promise<string[]> {
  const res = await fetch(`${BYBIT}/v5/market/tickers?category=linear`, {
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Bybit ticker 失败 ${res.status}`);
  const json = (await res.json()) as {
    retCode?: number;
    retMsg?: string;
    result?: { list?: Array<{ symbol: string; turnover24h?: string }> };
  };
  if (json.retCode !== 0) {
    throw new Error(`Bybit ticker 异常: ${json.retMsg ?? json.retCode}`);
  }
  const rows = json.result?.list ?? [];
  return rows
    .filter((r) => r.symbol.endsWith("USDT") && !r.symbol.includes("-"))
    .sort((a, b) => Number(b.turnover24h ?? 0) - Number(a.turnover24h ?? 0))
    .slice(0, limit)
    .map((r) => r.symbol);
}

/** Bybit K 线收盘价（linear） */
export async function fetchBybitKlineCloses(
  symbol: string,
  startDate: string,
  endDate: string,
  intervalRaw = "1d"
): Promise<DailyPoint[]> {
  const pair = toUsdtPair(symbol);
  if (!pair) return [];
  const interval = toBybitInterval(intervalRaw);
  const startMs = Date.parse(`${startDate}T00:00:00`);
  const endMs = Date.parse(`${endDate}T23:59:59`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];

  const step =
    interval === "D"
      ? 86_400_000
      : INTERVAL_MS[normalizeBinanceInterval(intervalRaw)] ?? 3_600_000;

  const out: DailyPoint[] = [];
  let cursor = startMs;
  let guard = 0;
  while (cursor <= endMs && guard < 40) {
    guard += 1;
    const url =
      `${BYBIT}/v5/market/kline?category=linear` +
      `&symbol=${encodeURIComponent(pair)}` +
      `&interval=${encodeURIComponent(interval)}` +
      `&start=${cursor}&end=${endMs}&limit=1000`;
    const res = await fetch(url);
    if (!res.ok) break;
    const json = (await res.json()) as {
      retCode?: number;
      result?: { list?: unknown[] };
    };
    if (json.retCode !== 0) break;
    const rows = json.result?.list ?? [];
    if (!rows.length) break;

    // Bybit 返回倒序：startTime, open, high, low, close, volume, turnover
    const chunk: DailyPoint[] = [];
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 5) continue;
      const openTime = Number(row[0]);
      const open = Number(row[1]);
      const close = Number(row[4]);
      if (!Number.isFinite(openTime) || !Number.isFinite(close)) continue;
      chunk.push({
        date: fmtLocalAxisLabel(openTime, interval === "D" ? "1d" : "1h"),
        close,
      });
      void open;
    }
    chunk.sort((a, b) => (a.date < b.date ? -1 : 1));
    out.push(...chunk);

    const lastMs = Number((rows[0] as unknown[])[0]); // 最新一根
    const oldestMs = Number((rows[rows.length - 1] as unknown[])[0]);
    if (!Number.isFinite(oldestMs)) break;
    const next = oldestMs + step;
    if (next <= cursor || rows.length < 200) {
      // 本页已覆盖；若仍未到 end，以最新推进
      if (Number.isFinite(lastMs) && lastMs + step > cursor) {
        cursor = lastMs + step;
      } else break;
    } else {
      cursor = next;
    }
    if (rows.length < 1000) break;
  }

  const map = new Map<string, number>();
  for (const p of out) map.set(p.date, p.close);
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, close]) => ({ date, close }));
}

export async function fetchBybitDailyBars(
  pair: string,
  startDate: string,
  endDate: string
): Promise<Array<{ date: string; open: number; close: number }>> {
  const points = await fetchBybitKlineCloses(pair, startDate, endDate, "1d");
  // 日线无 open 时用 close 近似（扫描只需要相邻收盘涨幅）
  return points.map((p) => ({ date: p.date, open: p.close, close: p.close }));
}
