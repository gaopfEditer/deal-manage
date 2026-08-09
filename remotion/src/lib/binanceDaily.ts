/** Binance 日线 K 线（经 Vite 代理，避免浏览器 CORS） */

const DAY = 86_400_000;

export type DailyPoint = { date: string; close: number };

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
 * 拉取单币种日线收盘价。
 * 开发环境走 `/binance/...` 代理；也可直连（部分环境可用）。
 */
export async function fetchBinanceDailyCloses(
  symbol: string,
  startDate: string,
  endDate: string
): Promise<DailyPoint[]> {
  const pair = toSymbolPair(symbol);
  if (!pair) return [];

  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T23:59:59Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
    throw new Error(`日期无效: ${startDate} → ${endDate}`);
  }

  const out: DailyPoint[] = [];
  let cursor = startMs;
  let guard = 0;
  // 分段拉满区间（币安单次最多 1000 根）
  while (cursor <= endMs && guard < 40) {
    guard += 1;
    const url =
      `/binance/api/v3/klines?symbol=${encodeURIComponent(pair)}` +
      `&interval=1d&startTime=${cursor}&endTime=${endMs}&limit=1000`;
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
      out.push({ date: fmtUTC(openTime), close });
    }
    const lastOpen = Number((rows[rows.length - 1] as unknown[])[0]);
    if (!Number.isFinite(lastOpen)) break;
    const next = lastOpen + DAY;
    if (next <= cursor) break;
    cursor = next;
    if (rows.length < 1000) break;
  }

  // 去重保序
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
