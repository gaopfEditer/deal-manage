import type { PriceSeriesPayload } from "../../lib/priceSource";

/** 横轴标签 → 自然日 YYYY-MM-DD（兼容 1h：`2024-01-15 14:00`） */
export function axisDateKey(label: string): string {
  return label.length >= 10 ? label.slice(0, 10) : label;
}

export function isHourlyAxis(dates: string[]): boolean {
  return dates.some((d) => d.includes(" "));
}

/** 价格序列 → 相对首有效价的累计收益率 % */
export function pricesToReturnPct(
  values: (number | null)[],
  maxIdx: number
): (number | null)[] {
  let base: number | null = null;
  for (let i = 0; i <= maxIdx; i++) {
    const v = values[i];
    if (v != null && v > 0) {
      base = v;
      break;
    }
  }
  if (base == null) return values.map((_, i) => (i <= maxIdx ? null : null));

  return values.map((v, i) => {
    if (i > maxIdx || v == null) return null;
    return Math.round((v / base - 1) * 10000) / 100;
  });
}

function lastIndexForDay(dates: string[], ymd: string, maxIdx: number): number {
  let last = -1;
  for (let i = 0; i <= maxIdx; i++) {
    if (axisDateKey(dates[i]) === ymd) last = i;
  }
  return last;
}

function firstIndexForDay(dates: string[], ymd: string, maxIdx: number): number {
  for (let i = 0; i <= maxIdx; i++) {
    if (axisDateKey(dates[i]) === ymd) return i;
  }
  return -1;
}

function lastIndexBeforeDay(dates: string[], ymd: string, maxIdx: number): number {
  let last = -1;
  for (let i = 0; i <= maxIdx; i++) {
    if (axisDateKey(dates[i]) < ymd) last = i;
    else break;
  }
  return last;
}

/** 按日涨跌幅在组合内取前三（1h 轴时按日聚合收盘） */
export function computeDailyTop3Leaders(
  payload: PriceSeriesPayload
): Record<string, string[]> {
  const { dates, series } = payload;
  const hourly = isHourlyAxis(dates);
  const out: Record<string, string[]> = {};

  if (!hourly) {
    for (let i = 1; i < dates.length; i++) {
      const date = dates[i];
      const rows: { sym: string; pct: number }[] = [];
      for (const [sym, vals] of Object.entries(series)) {
        const prev = vals[i - 1];
        const cur = vals[i];
        if (prev == null || cur == null || prev <= 0) continue;
        rows.push({ sym, pct: ((cur - prev) / prev) * 100 });
      }
      rows.sort((a, b) => b.pct - a.pct);
      const top = rows.slice(0, 3).map((r) => r.sym);
      if (top.length) out[date] = top;
    }
    return out;
  }

  const dayKeys = [...new Set(dates.map(axisDateKey))].sort();
  const dayClose: Record<string, Record<string, number>> = {};
  for (const day of dayKeys) {
    const idx = lastIndexForDay(dates, day, dates.length - 1);
    if (idx < 0) continue;
    dayClose[day] = {};
    for (const [sym, vals] of Object.entries(series)) {
      const v = vals[idx];
      if (v != null && v > 0) dayClose[day][sym] = v;
    }
  }

  for (let i = 1; i < dayKeys.length; i++) {
    const day = dayKeys[i];
    const prevDay = dayKeys[i - 1];
    const rows: { sym: string; pct: number }[] = [];
    for (const [sym, close] of Object.entries(dayClose[day] ?? {})) {
      const prev = dayClose[prevDay]?.[sym];
      if (prev == null || prev <= 0) continue;
      rows.push({ sym, pct: ((close - prev) / prev) * 100 });
    }
    rows.sort((a, b) => b.pct - a.pct);
    const top = rows.slice(0, 3).map((r) => r.sym);
    if (top.length) out[day] = top;
  }
  return out;
}

export function rankOnLeaderboard(
  leaders: Record<string, string[]>,
  axisLabel: string,
  sym: string
): number | null {
  const list = leaders[axisDateKey(axisLabel)];
  if (!list?.length) return null;
  const idx = list.indexOf(sym);
  return idx >= 0 ? idx + 1 : null;
}

/** 日榜前三在横轴上的标记点（1h 轴取当日最后一根 K） */
export function top3MarkPointsForSymbol(
  leaders: Record<string, string[]>,
  sym: string,
  dates: string[],
  endIdx: number
): Array<{ axisIdx: number; axisLabel: string; dayKey: string; rank: number }> {
  const out: Array<{ axisIdx: number; axisLabel: string; dayKey: string; rank: number }> = [];
  for (const [dayKey, list] of Object.entries(leaders)) {
    const rank = list.indexOf(sym);
    if (rank < 0) continue;
    const axisIdx = lastIndexForDay(dates, dayKey, endIdx);
    if (axisIdx < 0) continue;
    out.push({
      axisIdx,
      axisLabel: dates[axisIdx],
      dayKey,
      rank: rank + 1,
    });
  }
  return out.sort((a, b) => a.axisIdx - b.axisIdx);
}

/** 日榜前三对应的涨跌段（上一日末 → 当日末；首日无前一日时用当日首根 → 当日末） */
export function top3HighlightSegments(
  markers: Array<{ axisIdx: number; axisLabel: string; dayKey: string; rank: number }>,
  dates: string[],
  endIdx: number
): Array<{ fromIdx: number; toIdx: number; rank: number }> {
  return markers
    .map(({ axisIdx, dayKey, rank }) => {
      let fromIdx = lastIndexBeforeDay(dates, dayKey, endIdx);
      // 近七天第一天：轴上没有前一日收盘，改标当日整段
      if (fromIdx < 0) {
        fromIdx = firstIndexForDay(dates, dayKey, endIdx);
      }
      if (fromIdx < 0) return null;
      if (fromIdx >= axisIdx) {
        // 当日只有一根 K：退到前一根，仍能画出短线段
        if (axisIdx > 0) fromIdx = axisIdx - 1;
        else return null;
      }
      return { fromIdx, toIdx: axisIdx, rank };
    })
    .filter((x): x is { fromIdx: number; toIdx: number; rank: number } => x != null);
}

/** @deprecated 仅日线轴；1h 请用 top3MarkPointsForSymbol */
export function top3DatesForSymbol(
  leaders: Record<string, string[]>,
  sym: string,
  dates: string[]
): Array<{ date: string; rank: number }> {
  const hits: Array<{ date: string; rank: number }> = [];
  for (const date of dates) {
    const rank = rankOnLeaderboard(leaders, date, sym);
    if (rank != null) hits.push({ date, rank });
  }
  return hits;
}
