/** 腾讯日线：A 股/指数历史（分段拉取，覆盖起止日期） */

import type { DailyPoint } from "./binanceDaily";

const DAY = 86_400_000;

function parseYmd(ymd: string): number {
  return Date.parse(`${ymd}T00:00:00Z`);
}

function fmtYmd(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function addDays(ymd: string, delta: number): string {
  return fmtYmd(parseYmd(ymd) + delta * DAY);
}

/**
 * 腾讯日线收盘。
 * 单次最多约 640 根，按 end 向前分段拉直到覆盖 startDate。
 * 行格式：[date, open, close, high, low, volume, ...]
 */
export async function fetchTencentCnDailyCloses(
  code: string,
  startDate: string,
  endDate: string
): Promise<DailyPoint[]> {
  const symbol = code.trim().toLowerCase();
  if (!symbol) return [];

  const map = new Map<string, number>();
  let endCursor = endDate;
  let guard = 0;

  while (endCursor >= startDate && guard < 80) {
    guard += 1;
    const url =
      `/tencent/ifzqgtimg/appstock/app/newfqkline/get` +
      `?param=${encodeURIComponent(symbol)},day,${startDate},${endCursor},640,qfq`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${symbol} 腾讯日线失败 ${res.status}: ${text.slice(0, 100)}`);
    }
    const json = (await res.json()) as {
      code?: number;
      data?: Record<string, { day?: unknown[] }>;
      msg?: string;
    };
    if (json.code !== 0 && json.code != null) {
      throw new Error(`${symbol} 腾讯日线错误: ${json.msg ?? json.code}`);
    }
    const rows = json.data?.[symbol]?.day;
    if (!Array.isArray(rows) || rows.length === 0) break;

    let earliest = endCursor;
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 3) continue;
      const date = String(row[0]);
      const close = Number(row[2]);
      if (!date || !Number.isFinite(close)) continue;
      if (date < startDate || date > endDate) continue;
      map.set(date, close);
      if (date < earliest) earliest = date;
    }

    // 下一段：再往更早推
    const nextEnd = addDays(earliest, -1);
    if (nextEnd >= endCursor) break;
    endCursor = nextEnd;
    if (earliest <= startDate) break;
    if (rows.length < 100) break;
  }

  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, close]) => ({ date, close }));
}
