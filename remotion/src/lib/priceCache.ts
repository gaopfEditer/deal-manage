/**
 * 按日期区间缓存组合行情，最多保留 5 组（LRU）。
 * key = start|end|资产指纹
 */

import type { AssetLeg, PriceSeriesPayload } from "./priceSource";

export const PRICE_CACHE_MAX = 5;

export type PriceCacheEntry = {
  key: string;
  startDate: string;
  endDate: string;
  payload: PriceSeriesPayload;
  /** 最近使用时间，用于 LRU */
  touchedAt: number;
};

function legFingerprint(legs: AssetLeg[]): string {
  return legs
    .map((l) => `${l.source}:${l.symbol}:${l.label}:${l.url ?? ""}:${l.jsonKey ?? ""}`)
    .sort()
    .join(";");
}

export function makePriceCacheKey(
  startDate: string,
  endDate: string,
  legs: AssetLeg[]
): string {
  return `${startDate}|${endDate}|${legFingerprint(legs)}`;
}

const store = new Map<string, PriceCacheEntry>();

export function getPriceCache(key: string): PriceSeriesPayload | null {
  const hit = store.get(key);
  if (!hit) return null;
  hit.touchedAt = Date.now();
  // Map 保持插入序；重新 set 移到末尾便于观察，逻辑以 touchedAt 为准
  store.delete(key);
  store.set(key, hit);
  return hit.payload;
}

export function setPriceCache(
  key: string,
  startDate: string,
  endDate: string,
  payload: PriceSeriesPayload
): void {
  store.set(key, {
    key,
    startDate,
    endDate,
    payload,
    touchedAt: Date.now(),
  });
  while (store.size > PRICE_CACHE_MAX) {
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [k, v] of store) {
      if (v.touchedAt < oldestAt) {
        oldestAt = v.touchedAt;
        oldestKey = k;
      }
    }
    if (oldestKey) store.delete(oldestKey);
    else break;
  }
}

export function listPriceCacheKeys(): Array<{ startDate: string; endDate: string; key: string }> {
  return [...store.values()]
    .sort((a, b) => b.touchedAt - a.touchedAt)
    .map((e) => ({ startDate: e.startDate, endDate: e.endDate, key: e.key }));
}

export function clearPriceCache(): void {
  store.clear();
}

export function priceCacheSize(): number {
  return store.size;
}
