/** K 线周期 / 时间解析：支持 min、h、d 及入场出场外扩 */

export const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "6h": 21_600_000,
  "8h": 28_800_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
  "3d": 259_200_000,
  "1w": 604_800_000,
};

/** 无时区字符串默认按东八区（北京时间）理解 */
export const DEFAULT_TZ_OFFSET_MIN = 8 * 60;

/** 将 `15min` / `1h` / `1day` 等归一为 Binance interval */
export function normalizeBinanceInterval(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return "1h";

  const aliases: Record<string, string> = {
    min: "1m",
    m: "1m",
    h: "1h",
    hour: "1h",
    d: "1d",
    day: "1d",
    "1min": "1m",
    "3min": "3m",
    "5min": "5m",
    "15min": "15m",
    "15mins": "15m",
    "30min": "30m",
    "1mins": "1m",
    "1minute": "1m",
    "1hour": "1h",
    "1hr": "1h",
    "4hour": "4h",
    "4hr": "4h",
    "1day": "1d",
    "1days": "1d",
    "60m": "1h",
    "240m": "4h",
  };
  if (aliases[s]) return aliases[s];
  if (/^\d+min(?:ute)?s?$/.test(s)) return `${s.match(/^(\d+)/)?.[1] ?? "1"}m`;
  if (/^\d+[mhdw]$/.test(s)) return s;
  if (INTERVAL_MS[s]) return s;
  return s;
}

export function intervalToTimeframeLabel(interval: string): string {
  const n = normalizeBinanceInterval(interval);
  if (n.endsWith("m") && !n.endsWith("mo")) return `${n.slice(0, -1)}分钟`;
  if (n.endsWith("h")) return `${n.slice(0, -1)}小时`;
  if (n.endsWith("d")) return `${n.slice(0, -1)}天`;
  if (n.endsWith("w")) return `${n.slice(0, -1)}周`;
  return n;
}

function hasExplicitTz(s: string): boolean {
  return /Z$/i.test(s) || /[+-]\d{2}:?\d{2}$/.test(s);
}

/**
 * 解析时间戳。
 * - 带 Z / ±offset：按该时区
 * - 无时区：默认东八区墙钟（`2026-08-09 08:30` = 北京时间）
 */
export function parseTimeMs(
  raw: string,
  endOfDay = false,
  tzOffsetMin = DEFAULT_TZ_OFFSET_MIN
): number {
  const s = raw.trim();
  if (!s) return NaN;
  if (/^\d{13}$/.test(s)) return Number(s);
  if (/^\d{10}$/.test(s)) return Number(s) * 1000;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    if (endOfDay) {
      return Date.UTC(y, m - 1, d, 23, 59, 59, 999) - tzOffsetMin * 60_000;
    }
    return Date.UTC(y, m - 1, d, 0, 0, 0, 0) - tzOffsetMin * 60_000;
  }

  const normalized = s.includes("T") ? s : s.replace(" ", "T");
  if (hasExplicitTz(normalized)) {
    return Date.parse(normalized);
  }

  const m = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?$/
  );
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const hh = Number(m[4]);
    const mi = Number(m[5]);
    const ss = Number(m[6] ?? 0);
    const ms = Number((m[7] ?? "0").slice(0, 3).padEnd(3, "0"));
    return Date.UTC(y, mo - 1, d, hh, mi, ss, ms) - tzOffsetMin * 60_000;
  }

  return Date.parse(`${normalized}Z`);
}

/** 类目时间：东八区墙钟 `YYYY-MM-DD HH:mm`（与 trade.entry.time 一致） */
export function formatBarTimeUtc(
  openMs: number,
  tzOffsetMin = DEFAULT_TZ_OFFSET_MIN
): string {
  const d = new Date(openMs + tzOffsetMin * 60_000);
  const y = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}-${mm}-${dd} ${hh}:${mi}`;
}

export function categoryTimeToMs(cat: string): number {
  return parseTimeMs(cat, false);
}

/**
 * 按入场/出场时间向外扩展 padRatio（默认 20%）。
 * 跨度过短时至少覆盖约 10 根 K。
 */
export function expandRangeFromEntryExit(opts: {
  entryTime: string;
  exitTime?: string;
  interval: string;
  padRatio?: number;
}): { start: string; end: string } {
  const interval = normalizeBinanceInterval(opts.interval);
  const step = INTERVAL_MS[interval] ?? 3_600_000;
  const padRatio = opts.padRatio ?? 0.2;

  const a = parseTimeMs(opts.entryTime, false);
  const b = opts.exitTime ? parseTimeMs(opts.exitTime, false) : a;
  if (!Number.isFinite(a)) {
    throw new Error(`入场时间无效: ${opts.entryTime}`);
  }
  const lo = Math.min(a, Number.isFinite(b) ? b : a);
  const hi = Math.max(a, Number.isFinite(b) ? b : a);
  let span = hi - lo;
  if (span < step * 10) span = step * 10;
  const pad = span * padRatio;
  return {
    start: new Date(lo - pad).toISOString(),
    end: new Date(hi + pad).toISOString(),
  };
}

/** 找到覆盖 timeMs 的 K 线（open <= t 的最后一根） */
export function findBarIndexAtTime(
  categories: string[],
  timeRaw: string
): number {
  const t = parseTimeMs(timeRaw, false);
  if (!Number.isFinite(t) || !categories.length) return -1;

  let best = -1;
  for (let i = 0; i < categories.length; i++) {
    const open = categoryTimeToMs(categories[i]);
    if (!Number.isFinite(open)) continue;
    if (open <= t) best = i;
    else break;
  }
  if (best >= 0) return best;

  return 0;
}

export function isMarketPrice(price: unknown): boolean {
  if (price == null) return true;
  if (typeof price === "number") return false;
  const s = String(price).trim();
  if (!s) return true;
  if (/^市价|market|mkt$/i.test(s)) return true;
  return !Number.isFinite(Number(s));
}

export function coercePrice(price: unknown): number | undefined {
  if (typeof price === "number" && Number.isFinite(price)) return price;
  if (typeof price === "string" && !isMarketPrice(price)) {
    const n = Number(price);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}
