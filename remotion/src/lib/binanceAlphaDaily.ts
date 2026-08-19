/**
 * Binance 链上 Alpha 代币：列表 + K 线（bapi）
 */

import type { DailyPoint } from "./binanceDaily";
import { newAssetLeg } from "./priceSource";
import { INTERVAL_MS, normalizeBinanceInterval } from "./klineTime";
import {
  buildTopGainerComboFromPairs,
  TOP_GAINER_CHART_INTERVAL,
  type DayBar,
  type WeekScope,
  type WeeklyTopGainerCombo,
} from "./weeklyTopGainers";

const BAPI = "/binance-bapi";

export type AlphaTokenMeta = {
  alphaId: string;
  tradeSymbol: string;
  label: string;
};

let tokenCache: AlphaTokenMeta[] | null = null;
let tokenCacheAt = 0;
const TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

function fmtLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtLocalAxisLabel(ts: number, interval: string): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  if (interval === "1d") return fmtLocalYmd(d);
  const h = String(d.getHours()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:00`;
}

function parseKlineRows(raw: unknown, interval: string): DayBar[] {
  let rows: unknown[] = [];
  if (Array.isArray(raw)) {
    rows = raw;
  } else if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.klines)) rows = o.klines;
    else if (Array.isArray(o.data)) rows = o.data;
  }

  const out: DayBar[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const openTime = Number(row[0]);
    const open = Number(row[1]);
    const close = Number(row[4]);
    if (!Number.isFinite(openTime) || !Number.isFinite(open) || !Number.isFinite(close)) continue;
    out.push({
      date: fmtLocalAxisLabel(openTime, interval),
      open,
      close,
    });
  }
  return out;
}

/** 拉取 Alpha 代币列表（带 6h 内存缓存） */
export async function fetchAlphaTokenList(force = false): Promise<AlphaTokenMeta[]> {
  if (!force && tokenCache && Date.now() - tokenCacheAt < TOKEN_TTL_MS) {
    return tokenCache;
  }

  const res = await fetch(
    `${BAPI}/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list`
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Alpha 代币列表请求失败 ${res.status}: ${text.slice(0, 120)}`);
  }

  const json = (await res.json()) as { data?: unknown[]; success?: boolean };
  const rows = Array.isArray(json?.data) ? json.data : [];
  if (!rows.length) {
    if (tokenCache?.length) return tokenCache;
    throw new Error("Alpha 代币列表为空");
  }

  const list: AlphaTokenMeta[] = [];
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const alphaId = String(row.alphaId ?? row.alpha_id ?? "").trim();
    if (!alphaId) continue;
    const name = String(row.name ?? row.symbol ?? row.cexCoinName ?? alphaId).trim();
    const tradeSymbol = alphaId.endsWith("USDT") ? alphaId : `${alphaId}USDT`;
    list.push({
      alphaId,
      tradeSymbol,
      label: name || alphaId.replace(/^ALPHA_/, "α·"),
    });
  }

  if (!list.length) throw new Error("Alpha 代币列表解析失败");

  tokenCache = list;
  tokenCacheAt = Date.now();
  return list;
}

/** Alpha K 线（扫描仍用 1d；图表可指定 1h） */
export async function fetchAlphaKlineCloses(
  tradeSymbol: string,
  startDate: string,
  endDate: string,
  intervalRaw = "1d"
): Promise<DailyPoint[]> {
  const bars = await fetchAlphaKlineBars(tradeSymbol, startDate, endDate, intervalRaw);
  return bars.map((b) => ({ date: b.date, close: b.close }));
}

/** Alpha 日线收盘价（供组合加载） */
export async function fetchAlphaDailyCloses(
  tradeSymbol: string,
  startDate: string,
  endDate: string
): Promise<DailyPoint[]> {
  return fetchAlphaKlineCloses(tradeSymbol, startDate, endDate, "1d");
}

export async function fetchAlphaDailyBars(
  tradeSymbol: string,
  startDate: string,
  endDate: string
): Promise<DayBar[]> {
  return fetchAlphaKlineBars(tradeSymbol, startDate, endDate, "1d");
}

export async function fetchAlphaKlineBars(
  tradeSymbol: string,
  startDate: string,
  endDate: string,
  intervalRaw = "1d"
): Promise<DayBar[]> {
  const interval = normalizeBinanceInterval(intervalRaw);
  const sym = tradeSymbol.trim().toUpperCase();
  if (!sym) return [];

  const startMs = Date.parse(`${startDate}T00:00:00`);
  const endMs = Date.parse(`${endDate}T23:59:59`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];

  const step = INTERVAL_MS[interval] ?? 86_400_000;
  const out: DayBar[] = [];
  let cursor = startMs;
  let guard = 0;
  const maxPages = interval === "1d" ? 20 : 200;

  while (cursor <= endMs && guard < maxPages) {
    guard += 1;
    const url =
      `${BAPI}/bapi/defi/v1/public/alpha-trade/klines` +
      `?symbol=${encodeURIComponent(sym)}` +
      `&interval=${encodeURIComponent(interval)}&startTime=${cursor}&endTime=${endMs}&limit=1000`;

    const res = await fetch(url);
    if (!res.ok) break;

    const json = await res.json();
    const data =
      json && typeof json === "object" && "data" in (json as object)
        ? (json as { data: unknown }).data
        : json;
    const chunk = parseKlineRows(data, interval);
    if (!chunk.length) break;
    out.push(...chunk);

    const lastDate = chunk[chunk.length - 1].date;
    const lastMs = Date.parse(lastDate.includes(" ") ? `${lastDate.replace(" ", "T")}:00` : `${lastDate}T00:00:00`);
    if (!Number.isFinite(lastMs)) break;
    const next = lastMs + step;
    if (next <= cursor) break;
    cursor = next;
    if (chunk.length < 1000) break;
  }

  const map = new Map<string, DayBar>();
  for (const b of out) map.set(b.date, b);
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

const labelByTradeSymbol = new Map<string, string>();

function pairToAlphaLabel(tradeSymbol: string): string {
  return labelByTradeSymbol.get(tradeSymbol) ?? tradeSymbol.replace(/^ALPHA_/, "α·");
}

/** 涨幅榜组合图表用 1h，扫描仍按日线 */
export { TOP_GAINER_CHART_INTERVAL } from "./weeklyTopGainers";

/**
 * 链上 Alpha：在 Alpha 代币池内按日涨幅取前三，合并为组合。
 */
export async function buildWeeklyAlphaTopGainerCombo(
  scope: WeekScope
): Promise<WeeklyTopGainerCombo> {
  const tokens = await fetchAlphaTokenList();
  labelByTradeSymbol.clear();
  for (const t of tokens) {
    labelByTradeSymbol.set(t.tradeSymbol, t.label);
  }

  const pairs = tokens.map((t) => t.tradeSymbol);
  if (!pairs.length) throw new Error("未获取到 Alpha 代币交易对");

  return buildTopGainerComboFromPairs({
    scope,
    metaPrefix: "Alpha每日涨幅前三",
    pairs,
    pairToBase: pairToAlphaLabel,
    fetchDailyBars: fetchAlphaDailyBars,
    concurrency: 6,
    makeLeg: (_label, tradeSymbol) =>
      newAssetLeg({
        source: "binance-alpha",
        symbol: tradeSymbol,
        label: pairToAlphaLabel(tradeSymbol),
        interval: TOP_GAINER_CHART_INTERVAL,
      }),
  });
}
