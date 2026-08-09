/**
 * 最近操作币种本地缓存：最多 5 个币种，每币种最多 2 个时间段（LRU）。
 * - 浏览器：localStorage
 * - Node（Remotion calculateMetadata）：.cache/trade-recent-cache.json
 */

import type { TradingViewKlineBar } from "./types";

export const TRADE_SYMBOL_CACHE_MAX = 5;
export const TRADE_RANGES_PER_SYMBOL = 2;

const STORAGE_KEY = "deal-manage.trade-recent-cache.v2";

export type TradeRangeCacheEntry = {
  rangeKey: string;
  interval: string;
  start: string;
  end: string;
  bars: TradingViewKlineBar[];
  /** 布林等指标预热收盘价（不展示） */
  indicatorSeedCloses?: number[];
  touchedAt: number;
};

export type TradeKlineCacheHit = {
  bars: TradingViewKlineBar[];
  indicatorSeedCloses: number[];
};

export type TradeSymbolCacheEntry = {
  symbol: string;
  ranges: TradeRangeCacheEntry[];
  touchedAt: number;
};

type Store = {
  symbols: TradeSymbolCacheEntry[];
};

let memory: Store = { symbols: [] };
let ready: Promise<void> | null = null;

export function makeTradeRangeKey(
  symbol: string,
  interval: string,
  start: string,
  end: string
): string {
  return `${symbol.toUpperCase()}|${interval}|${start}|${end}`;
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function readLocalStorage(): Store | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Store;
    if (parsed?.symbols && Array.isArray(parsed.symbols)) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

type NodeProc = { versions?: { node?: string }; cwd: () => string };

function nodeProcess(): NodeProc | null {
  const p = (globalThis as { process?: NodeProc }).process;
  return p?.versions?.node ? p : null;
}

async function dynImport<T>(spec: string): Promise<T> {
  // 避免 tsc 解析 node 内置模块类型
  return (new Function("s", "return import(s)"))(spec) as Promise<T>;
}

async function readNodeFile(): Promise<Store | null> {
  const proc = nodeProcess();
  if (!proc) return null;
  try {
    const fs = await dynImport<{
      readFile: (p: string, e: string) => Promise<string>;
    }>("fs/promises");
    const path = await dynImport<{ join: (...parts: string[]) => string }>("path");
    const file = path.join(proc.cwd(), ".cache", "trade-recent-cache.json");
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Store;
    if (parsed?.symbols && Array.isArray(parsed.symbols)) return parsed;
  } catch {
    /* missing file */
  }
  return null;
}

async function writePersist(store: Store): Promise<void> {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      /* quota */
    }
  }
  const proc = nodeProcess();
  if (!proc) return;
  try {
    const fs = await dynImport<{
      mkdir: (p: string, o: { recursive: boolean }) => Promise<void>;
      writeFile: (p: string, d: string, e: string) => Promise<void>;
    }>("fs/promises");
    const path = await dynImport<{ join: (...parts: string[]) => string }>("path");
    const dir = path.join(proc.cwd(), ".cache");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "trade-recent-cache.json"),
      JSON.stringify(store),
      "utf8"
    );
  } catch {
    /* ignore */
  }
}

/** hydrate / 拉 K 前调用一次 */
export async function initTradeRecentCache(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const fromLs = readLocalStorage();
      if (fromLs) {
        memory = fromLs;
        return;
      }
      const fromDisk = await readNodeFile();
      if (fromDisk) memory = fromDisk;
    })();
  }
  await ready;
}

function touchSymbol(store: Store, symbol: string): TradeSymbolCacheEntry {
  const sym = normalizeSymbol(symbol);
  let entry = store.symbols.find((s) => s.symbol === sym);
  const now = Date.now();
  if (!entry) {
    entry = { symbol: sym, ranges: [], touchedAt: now };
    store.symbols.push(entry);
  } else {
    entry.touchedAt = now;
  }
  store.symbols.sort((a, b) => b.touchedAt - a.touchedAt);
  while (store.symbols.length > TRADE_SYMBOL_CACHE_MAX) {
    store.symbols.pop();
  }
  return entry;
}

export function getTradeKlineCache(
  symbol: string,
  interval: string,
  start: string,
  end: string
): TradeKlineCacheHit | null {
  const sym = normalizeSymbol(symbol);
  const entry = memory.symbols.find((s) => s.symbol === sym);
  if (!entry) return null;

  const rangeKey = makeTradeRangeKey(sym, interval, start, end);
  const hit = entry.ranges.find((r) => r.rangeKey === rangeKey);
  // 旧缓存无 seed 时视为未命中，强制重拉以保证布林预热
  if (!hit?.bars?.length || !hit.indicatorSeedCloses) return null;

  const now = Date.now();
  hit.touchedAt = now;
  entry.touchedAt = now;
  entry.ranges.sort((a, b) => b.touchedAt - a.touchedAt);
  memory.symbols.sort((a, b) => b.touchedAt - a.touchedAt);
  void writePersist(memory);
  return {
    bars: hit.bars,
    indicatorSeedCloses: hit.indicatorSeedCloses,
  };
}

export function setTradeKlineCache(
  symbol: string,
  interval: string,
  start: string,
  end: string,
  bars: TradingViewKlineBar[],
  indicatorSeedCloses: number[] = []
): void {
  if (!bars.length) return;
  const entry = touchSymbol(memory, symbol);
  const rangeKey = makeTradeRangeKey(entry.symbol, interval, start, end);
  const now = Date.now();
  const row: TradeRangeCacheEntry = {
    rangeKey,
    interval,
    start,
    end,
    bars,
    indicatorSeedCloses,
    touchedAt: now,
  };
  const idx = entry.ranges.findIndex((r) => r.rangeKey === rangeKey);
  if (idx >= 0) entry.ranges[idx] = row;
  else entry.ranges.push(row);

  entry.ranges.sort((a, b) => b.touchedAt - a.touchedAt);
  while (entry.ranges.length > TRADE_RANGES_PER_SYMBOL) {
    entry.ranges.pop();
  }
  memory.symbols.sort((a, b) => b.touchedAt - a.touchedAt);
  while (memory.symbols.length > TRADE_SYMBOL_CACHE_MAX) {
    memory.symbols.pop();
  }
  void writePersist(memory);
}

export function touchTradeSymbol(symbol: string): void {
  touchSymbol(memory, symbol);
  void writePersist(memory);
}

export function listTradeRecentCache(): Array<{
  symbol: string;
  ranges: Array<{ interval: string; start: string; end: string }>;
}> {
  return memory.symbols
    .slice()
    .sort((a, b) => b.touchedAt - a.touchedAt)
    .map((s) => ({
      symbol: s.symbol,
      ranges: s.ranges
        .slice()
        .sort((a, b) => b.touchedAt - a.touchedAt)
        .map((r) => ({
          interval: r.interval,
          start: r.start,
          end: r.end,
        })),
    }));
}

export function clearTradeRecentCache(): void {
  memory = { symbols: [] };
  void writePersist(memory);
}
