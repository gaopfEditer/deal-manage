/** 按起止时间拉取 K 线，供 Remotion calculateMetadata / 工程 hydrate 使用 */

import { toSymbolPair } from "./binanceDaily";
import type { TradingViewKlineBar } from "./types";
import { clampEmaPeriod, computeEma } from "../timeline/elements/echartKlineHelpers";
import {
  INTERVAL_MS,
  formatBarTimeUtc,
  normalizeBinanceInterval,
  parseTimeMs,
} from "./klineTime";

export type DynamicKlineFetch = {
  source?: "binance";
  symbol: string;
  /** 支持 15min / 15m / 1h / 1d 等 */
  interval: string;
  /** ISO / `YYYY-MM-DD` / `YYYY-MM-DD HH:mm` */
  start: string;
  end: string;
  /** 为 Vegas / 布林预热多拉的根数（不展示），默认至少 169 */
  warmupBars?: number;
};

/**
 * Remotion Studio / Render 的 bundle 里也有 window，相对路径 `/binance` 会落到
 * webpack 临时目录导致 404。此处始终直连公开 API（勿走 Vite 代理）。
 */
function binanceBase(): string {
  return "https://data-api.binance.vision";
}

type RawBar = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

async function fetchBinanceKlinesRaw(
  pair: string,
  interval: string,
  startMs: number,
  endMs: number
): Promise<RawBar[]> {
  const step = INTERVAL_MS[interval] ?? 3_600_000;
  const out: RawBar[] = [];
  let cursor = startMs;
  let guard = 0;

  while (cursor <= endMs && guard < 80) {
    guard += 1;
    const url =
      `${binanceBase()}/api/v3/klines?symbol=${encodeURIComponent(pair)}` +
      `&interval=${encodeURIComponent(interval)}` +
      `&startTime=${cursor}&endTime=${endMs}&limit=1000`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${pair} K线请求失败 ${res.status}: ${text.slice(0, 160)}`);
    }
    const rows = (await res.json()) as unknown[];
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 6) continue;
      const openTime = Number(row[0]);
      const open = Number(row[1]);
      const high = Number(row[2]);
      const low = Number(row[3]);
      const close = Number(row[4]);
      const volume = Number(row[5]);
      if (![openTime, open, high, low, close, volume].every(Number.isFinite)) continue;
      out.push({ openTime, open, high, low, close, volume });
    }

    const lastOpen = Number((rows[rows.length - 1] as unknown[])[0]);
    if (!Number.isFinite(lastOpen)) break;
    const next = lastOpen + step;
    if (next <= cursor) break;
    cursor = next;
    if (rows.length < 1000) break;
  }

  const map = new Map<number, RawBar>();
  for (const b of out) map.set(b.openTime, b);
  return [...map.values()].sort((a, b) => a.openTime - b.openTime);
}

export type DynamicKlineFetchResult = {
  /** 仅 [start, end] 展示窗口内的 K 线 */
  bars: TradingViewKlineBar[];
  /**
   * 窗口之前的收盘价（warmup），只给布林/均线预热，不渲染。
   * 长度可达 warmupBars，保证展示首根起就有完整布林带。
   */
  indicatorSeedCloses: number[];
};

function pushBar(
  bars: TradingViewKlineBar[],
  b: RawBar,
  v144: number,
  v169: number
): void {
  bars.push([
    formatBarTimeUtc(b.openTime),
    Math.round(b.open * 10000) / 10000,
    Math.round(b.close * 10000) / 10000,
    Math.round(b.low * 10000) / 10000,
    Math.round(b.high * 10000) / 10000,
    Math.round(b.volume * 100) / 100,
    Math.round(v144 * 10000) / 10000,
    Math.round(v169 * 10000) / 10000,
    null,
    null,
    null,
  ]);
}

/**
 * 拉取区间 K 线并填成 TradingView bars（含 Vegas 144/169）。
 * 向前多拉 warmup 根用于 EMA / 布林预热；
 * 返回的 bars 只含 [start, end]，预热收盘价放在 indicatorSeedCloses（不展示）。
 */
export async function fetchTradingViewBarsDynamic(
  dyn: DynamicKlineFetch
): Promise<DynamicKlineFetchResult> {
  const pair = toSymbolPair(dyn.symbol);
  if (!pair) throw new Error(`dynamic.symbol 无效: ${dyn.symbol}`);

  const interval = normalizeBinanceInterval(dyn.interval || "1h");
  let startMs = parseTimeMs(dyn.start, false);
  let endMs = parseTimeMs(dyn.end, true);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
    throw new Error(`dynamic 起止时间无效: ${dyn.start} → ${dyn.end}`);
  }

  // 结束时间不能超过当前（否则「未来」区间必然空）
  const now = Date.now();
  if (endMs > now) endMs = now;
  if (startMs >= endMs) {
    const step0 = INTERVAL_MS[interval] ?? 3_600_000;
    startMs = Math.max(0, endMs - step0 * 48);
  }

  const step = INTERVAL_MS[interval] ?? 3_600_000;
  // 至少覆盖 Vegas 169 + 布林默认 20
  const warmup = Math.max(0, dyn.warmupBars ?? 200, 169);
  const fetchStart = Math.max(0, startMs - warmup * step);

  const raw = await fetchBinanceKlinesRaw(pair, interval, fetchStart, endMs);
  if (raw.length === 0) {
    throw new Error(
      `未拉到 K 线: ${pair} ${interval} ${new Date(startMs).toISOString()}→${new Date(endMs).toISOString()}（无时区时间按北京时间解析）`
    );
  }

  const closes = raw.map((b) => b.close);
  const p144 = clampEmaPeriod(144, closes.length);
  const p169 = clampEmaPeriod(169, closes.length);
  const ema144 = computeEma(closes, p144);
  const ema169 = computeEma(closes, p169);

  const indicatorSeedCloses: number[] = [];
  for (const b of raw) {
    if (b.openTime < startMs) indicatorSeedCloses.push(b.close);
  }

  const bars: TradingViewKlineBar[] = [];
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i];
    if (b.openTime < startMs || b.openTime > endMs) continue;
    pushBar(bars, b, ema144[i] ?? b.close, ema169[i] ?? b.close);
  }

  if (bars.length === 0) {
    // 严格过滤为空时，回退用已拉到的最近一段（仍在 warmup 窗口内）
    const fallback = raw.filter((b) => b.openTime <= endMs).slice(-120);
    if (fallback.length === 0) {
      throw new Error(
        `区间内无 K 线: ${pair} ${interval} ${new Date(startMs).toISOString()}→${new Date(endMs).toISOString()}。请确认交易对，或把入场/出场改为已有行情的北京时间`
      );
    }
    const fallbackSet = new Set(fallback.map((f) => f.openTime));
    const seedCut = fallback[0]?.openTime ?? startMs;
    indicatorSeedCloses.length = 0;
    for (const b of raw) {
      if (b.openTime < seedCut) indicatorSeedCloses.push(b.close);
    }
    for (let i = 0; i < raw.length; i++) {
      const b = raw[i];
      if (!fallbackSet.has(b.openTime)) continue;
      pushBar(bars, b, ema144[i] ?? b.close, ema169[i] ?? b.close);
    }
  }

  return { bars, indicatorSeedCloses };
}
