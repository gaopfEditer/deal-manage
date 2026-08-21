/**
 * 多来源价格序列：Binance / 新浪 / 银行定存 / 自定义 JSON·URL
 * 可组合例如：纳斯达克 + 沪深300 + BTC + 银行5年整存整取
 */

import { fetchBinanceDailyCloses, fetchBinanceFuturesKlineCloses, fetchBinanceKlineCloses, todayYmd, type DailyPoint } from "./binanceDaily";
import { fetchAlphaDailyCloses, fetchAlphaKlineCloses } from "./binanceAlphaDaily";
import { fetchBybitKlineCloses } from "./bybitDaily";
import { fetchGateDailyCloses } from "./gateDaily";
import { fetchSinaDailyCloses } from "./sinaDaily";
import { normalizeBinanceInterval } from "./klineTime";

export type PriceSeriesPayload = {
  dates: string[];
  series: Record<string, (number | null)[]>;
  meta: {
    source: string;
    label: string;
    /** 每日涨幅榜前三（动态组合扫描结果；无则图表内回退计算） */
    dailyLeaders?: Record<string, string[]>;
    /** K 线粒度，如 1h / 1d */
    interval?: string;
  };
};

export type AssetSourceKind =
  | "binance"
  | "binance-futures"
  | "binance-alpha"
  | "bybit"
  | "gate"
  | "sina"
  | "bank-deposit"
  | "custom-json"
  | "custom-url";

export type AssetLeg = {
  id: string;
  source: AssetSourceKind;
  /** 行情代码：BTC / ^IXIC / 000300.SS；银行定存可填 BANK5Y */
  symbol: string;
  /** 图例与字幕里的显示名 */
  label: string;
  /** 仅 custom-url */
  url?: string;
  /** 仅 custom-json：该腿在 JSON 里的 key（默认用 label） */
  jsonKey?: string;
  /** K 线周期，默认 1d；涨幅榜/Alpha 组合为 1h */
  interval?: string;
};

/**
 * 五年期整存整取近似挂牌年化（%）。
 * 参考央行基准/大行挂牌粗线条变迁（非精确逐日表）；2000–2026 时间加权约 3.2%。
 */
export const BANK_5Y_RATE_BANDS: ReadonlyArray<{ from: string; pct: number }> = [
  { from: "2000-01-01", pct: 2.88 },
  { from: "2002-02-21", pct: 2.79 },
  { from: "2004-10-29", pct: 3.6 },
  { from: "2006-08-19", pct: 4.14 },
  { from: "2007-12-21", pct: 5.85 },
  { from: "2008-12-23", pct: 3.6 },
  { from: "2010-10-20", pct: 4.2 },
  { from: "2011-07-07", pct: 5.5 },
  { from: "2012-07-06", pct: 4.75 },
  { from: "2014-11-22", pct: 3.75 },
  { from: "2015-10-24", pct: 2.75 },
  { from: "2023-06-08", pct: 2.5 },
  { from: "2023-12-22", pct: 2.0 },
  { from: "2024-07-25", pct: 1.8 },
  { from: "2025-05-20", pct: 1.55 },
];

/** 扁平均值（展示/注释用） */
export const BANK_5Y_AVG_ANNUAL_RATE_PCT = 3.2;

export function bank5yRateOn(date: string): number {
  let pct = BANK_5Y_RATE_BANDS[0].pct;
  for (const band of BANK_5Y_RATE_BANDS) {
    if (date >= band.from) pct = band.pct;
    else break;
  }
  return pct;
}

export function newAssetLeg(partial?: Partial<AssetLeg>): AssetLeg {
  return {
    id: `leg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    source: "binance",
    symbol: "BTC",
    label: "BTC",
    ...partial,
  };
}

export const DEFAULT_MIXED_LEGS: AssetLeg[] = [
  newAssetLeg({ source: "sina", symbol: ".IXIC", label: "纳斯达克" }),
  newAssetLeg({ source: "sina", symbol: "sh000300", label: "沪深300" }),
  /** Gate 现货 BTC_USDT 约 2013-03 起，早于 Binance 现货 2017-08 */
  newAssetLeg({ source: "gate", symbol: "BTC", label: "BTC" }),
  newAssetLeg({
    source: "bank-deposit",
    symbol: "BANK5Y",
    label: "银行5年期整存整取",
  }),
];

/** 热门交易所平台币涨幅对比（点击组合后需再点「加载组合」拉数） */
export const HOT_PLATFORM_COIN_LEGS: AssetLeg[] = [
  newAssetLeg({ source: "binance", symbol: "BNB", label: "BNB·币安" }),
  newAssetLeg({ source: "gate", symbol: "OKB", label: "OKB·欧易" }),
  newAssetLeg({ source: "gate", symbol: "GT", label: "GT·Gate" }),
  newAssetLeg({ source: "gate", symbol: "CRO", label: "CRO·Crypto.com" }),
  newAssetLeg({ source: "gate", symbol: "HT", label: "HT·火币" }),
];

export type AssetPresetId = "macro-mix" | "hot-platform" | "daily-top-gainers" | "daily-top-gainers-alpha";

export type AssetPreset = {
  id: AssetPresetId;
  /** 按钮文案 */
  name: string;
  /** 点选组合时建议的起始日 */
  startDate: string;
  legs: () => AssetLeg[];
  /** 加载时动态解析资产（如每日涨幅前三） */
  dynamic?: "weekly-top-gainers" | "weekly-alpha-top-gainers";
};

export const ASSET_PRESETS: AssetPreset[] = [
  {
    id: "macro-mix",
    name: "纳斯达克+沪深300+BTC+银行5年期整存整取",
    startDate: "2010-01-01",
    legs: () => DEFAULT_MIXED_LEGS.map((l) => ({ ...l, id: newAssetLeg(l).id })),
  },
  {
    id: "hot-platform",
    name: "热门平台币涨幅",
    startDate: "2019-01-01",
    legs: () => HOT_PLATFORM_COIN_LEGS.map((l) => ({ ...l, id: newAssetLeg(l).id })),
  },
  {
    id: "daily-top-gainers",
    name: "近七天合约每日涨幅前三",
    startDate: "",
    dynamic: "weekly-top-gainers",
    legs: () => [],
  },
  {
    id: "daily-top-gainers-alpha",
    name: "近七天Alpha每日涨幅前三",
    startDate: "",
    dynamic: "weekly-alpha-top-gainers",
    legs: () => [],
  },
];

export function clonePresetLegs(preset: AssetPreset): AssetLeg[] {
  return preset.legs();
}

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

function formatYmd(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 在给定日期轴上生成定存净值（起点=100，按当时年化单利日累） */
export function buildBankDepositOnDates(
  dates: string[],
  startDate: string,
  base = 100
): DailyPoint[] {
  const sorted = [...dates].filter((d) => d >= startDate).sort();
  if (!sorted.length) return [];
  let value = base;
  let prev: string | null = null;
  const out: DailyPoint[] = [];
  for (const d of sorted) {
    if (prev == null) {
      value = base;
    } else {
      const days =
        (parseYmd(d).getTime() - parseYmd(prev).getTime()) / 86_400_000;
      const rate = bank5yRateOn(prev);
      value *= 1 + (rate / 100) * (days / 365);
    }
    out.push({ date: d, close: value });
    prev = d;
  }
  return out;
}

/** 仅定存时：按日生成（间隔过大时可抽稀） */
export function buildBankDepositPoints(
  startDate: string,
  endDate: string,
  base = 100
): DailyPoint[] {
  const start = parseYmd(startDate);
  const end = parseYmd(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }
  const dates: string[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    dates.push(formatYmd(new Date(t)));
  }
  return buildBankDepositOnDates(dates, startDate, base);
}

function isBundleWithDates(v: unknown): v is {
  dates: string[];
  series: Record<string, (number | null)[]>;
} {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o.dates) && o.series != null && typeof o.series === "object";
}

export function parseCustomPriceJson(raw: unknown): PriceSeriesPayload {
  if (isBundleWithDates(raw)) {
    const dates = [...raw.dates].map(String).sort();
    const series: Record<string, (number | null)[]> = {};
    for (const [sym, arr] of Object.entries(raw.series)) {
      const list = Array.isArray(arr) ? arr : [];
      series[sym] = dates.map((_, i) => {
        const n = Number(list[i]);
        return Number.isFinite(n) ? n : null;
      });
    }
    return {
      dates,
      series,
      meta: { source: "custom-json", label: "自定义 JSON" },
    };
  }

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const dateSet = new Set<string>();
    const maps: Record<string, Map<string, number>> = {};
    for (const [sym, points] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(points)) continue;
      const m = new Map<string, number>();
      for (const p of points) {
        if (!p || typeof p !== "object") continue;
        const date = String((p as { date?: unknown }).date ?? "");
        const close = Number((p as { close?: unknown }).close);
        if (!date || !Number.isFinite(close)) continue;
        m.set(date, close);
        dateSet.add(date);
      }
      if (m.size) maps[sym] = m;
    }
    const dates = [...dateSet].sort();
    const series: Record<string, (number | null)[]> = {};
    for (const [sym, m] of Object.entries(maps)) {
      series[sym] = dates.map((d) => (m.has(d) ? (m.get(d) as number) : null));
    }
    if (!dates.length) throw new Error("自定义数据无有效日期点");
    return {
      dates,
      series,
      meta: { source: "custom-json", label: "自定义 JSON" },
    };
  }

  throw new Error(
    "自定义 JSON 格式无效。支持 { dates, series } 或 { SYMBOL: [{date, close}] }"
  );
}

async function pointsFromCustomJson(
  jsonText: string,
  key: string
): Promise<DailyPoint[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("自定义 JSON 解析失败");
  }
  const bundle = parseCustomPriceJson(parsed);
  const seriesKey =
    Object.keys(bundle.series).find((k) => k === key) ??
    Object.keys(bundle.series).find((k) => k.toUpperCase() === key.toUpperCase());
  if (!seriesKey) {
    throw new Error(`自定义 JSON 中找不到序列「${key}」`);
  }
  return bundle.dates
    .map((date, i) => {
      const close = bundle.series[seriesKey][i];
      return close == null ? null : { date, close };
    })
    .filter((p): p is DailyPoint => p != null);
}

async function pointsFromCustomUrl(url: string, key: string): Promise<DailyPoint[]> {
  const res = await fetch(url.trim());
  if (!res.ok) throw new Error(`自定义 URL 请求失败 ${res.status}`);
  const parsed = await res.json();
  const bundle = parseCustomPriceJson(parsed);
  const seriesKey =
    Object.keys(bundle.series).find((k) => k === key) ??
    Object.keys(bundle.series).find((k) => k.toUpperCase() === key.toUpperCase());
  if (!seriesKey) throw new Error(`URL 数据中找不到序列「${key}」`);
  return bundle.dates
    .map((date, i) => {
      const close = bundle.series[seriesKey][i];
      return close == null ? null : { date, close };
    })
    .filter((p): p is DailyPoint => p != null);
}

async function fetchLegPoints(
  leg: AssetLeg,
  startDate: string,
  endDate: string,
  sharedJsonText: string
): Promise<DailyPoint[]> {
  const key = (leg.jsonKey || leg.label || leg.symbol).trim();
  const interval = normalizeBinanceInterval(leg.interval ?? "1d");
  if (leg.source === "binance") {
    if (interval === "1d") {
      return fetchBinanceDailyCloses(leg.symbol, startDate, endDate);
    }
    return fetchBinanceKlineCloses(leg.symbol, startDate, endDate, interval);
  }
  if (leg.source === "binance-futures") {
    try {
      return await fetchBinanceFuturesKlineCloses(leg.symbol, startDate, endDate, interval);
    } catch {
      try {
        return await fetchBybitKlineCloses(leg.symbol, startDate, endDate, interval);
      } catch {
        return fetchBinanceKlineCloses(leg.symbol, startDate, endDate, interval);
      }
    }
  }
  if (leg.source === "bybit") {
    try {
      return await fetchBybitKlineCloses(leg.symbol, startDate, endDate, interval);
    } catch {
      return fetchBinanceKlineCloses(leg.symbol, startDate, endDate, interval);
    }
  }
  if (leg.source === "binance-alpha") {
    if (interval === "1d") {
      return fetchAlphaDailyCloses(leg.symbol, startDate, endDate);
    }
    return fetchAlphaKlineCloses(leg.symbol, startDate, endDate, interval);
  }
  if (leg.source === "gate") {
    return fetchGateDailyCloses(leg.symbol, startDate, endDate);
  }
  if (leg.source === "sina") {
    return fetchSinaDailyCloses(leg.symbol, startDate, endDate);
  }
  if (leg.source === "custom-json") {
    return pointsFromCustomJson(sharedJsonText, key);
  }
  if (leg.source === "custom-url") {
    if (!leg.url?.trim()) throw new Error(`${leg.label}: 请填写 URL`);
    return pointsFromCustomUrl(leg.url, key);
  }
  if (leg.source === "bank-deposit") {
    // 由 loadMixedAssets 单独对齐日期轴
    return buildBankDepositPoints(startDate, endDate);
  }
  throw new Error(`未知来源: ${leg.source as string}`);
}

/** 合并多腿：日期并集；缺口前向填充，便于跨市场对齐 */
export function mergeDailyLegs(
  legs: Array<{ label: string; points: DailyPoint[]; source: string }>,
  metaExtra?: Partial<PriceSeriesPayload["meta"]>
): PriceSeriesPayload {
  const dateSet = new Set<string>();
  for (const leg of legs) for (const p of leg.points) dateSet.add(p.date);
  const dates = [...dateSet].sort();
  if (!dates.length) throw new Error("合并后无数据");

  const series: Record<string, (number | null)[]> = {};
  for (const leg of legs) {
    const m = new Map(leg.points.map((p) => [p.date, p.close]));
    // 首个有效点之前保持 null（不虚构）；之后缺口前向填充
    let last: number | null = null;
    let started = false;
    series[leg.label] = dates.map((d) => {
      if (m.has(d)) {
        last = m.get(d) as number;
        started = true;
        return last;
      }
      return started ? last : null;
    });
  }

  const sources = [...new Set(legs.map((l) => l.source))];
  return {
    dates,
    series,
    meta: {
      source: sources.join("+"),
      label: legs.map((l) => l.label).join(" / "),
      ...metaExtra,
    },
  };
}

export type LoadMixedOptions = {
  legs: AssetLeg[];
  startDate?: string;
  endDate?: string;
  /** 各腿 custom-json 共用的粘贴文本 */
  customJsonText?: string;
};

/** 多来源组合加载 */
export async function loadMixedAssets(opts: LoadMixedOptions): Promise<PriceSeriesPayload> {
  const end = opts.endDate || todayYmd();
  const start = opts.startDate || "2010-01-01";
  const legs = opts.legs.filter(
    (l) =>
      l.label.trim() &&
      (l.symbol.trim() ||
        l.source.startsWith("custom") ||
        l.source === "bank-deposit")
  );
  if (!legs.length) throw new Error("请至少添加一条资产");

  const labels = new Set<string>();
  for (const leg of legs) {
    if (labels.has(leg.label)) throw new Error(`显示名重复：${leg.label}`);
    labels.add(leg.label);
  }

  const bankLegs = legs.filter((l) => l.source === "bank-deposit");
  const marketLegs = legs.filter((l) => l.source !== "bank-deposit");

  const marketResults = await Promise.all(
    marketLegs.map(async (leg) => {
      try {
        const points = await fetchLegPoints(leg, start, end, opts.customJsonText ?? "");
        if (!points.length) throw new Error("无数据");
        return { label: leg.label, points, source: leg.source };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`${leg.label}（${leg.source}:${leg.symbol}）失败：${msg}`);
      }
    })
  );

  // 定存对齐其他资产日期轴，避免日历日把横轴撑爆
  let axisDates: string[] = [];
  if (marketResults.length) {
    const set = new Set<string>();
    for (const r of marketResults) for (const p of r.points) set.add(p.date);
    axisDates = [...set].sort();
  } else {
    axisDates = buildBankDepositPoints(start, end).map((p) => p.date);
  }

  const bankResults = bankLegs.map((leg) => {
    const points = buildBankDepositOnDates(axisDates, start);
    if (!points.length) {
      throw new Error(`${leg.label}（银行定存）无数据`);
    }
    return { label: leg.label, points, source: leg.source };
  });

  return mergeDailyLegs([...marketResults, ...bankResults], {
    interval: resolvePayloadInterval(legs),
  });
}

function resolvePayloadInterval(legs: AssetLeg[]): string | undefined {
  const ivs = legs
    .map((l) => l.interval)
    .filter(Boolean)
    .map((iv) => normalizeBinanceInterval(iv!));
  if (!ivs.length) return undefined;
  const uniq = [...new Set(ivs)];
  return uniq.length === 1 ? uniq[0] : undefined;
}

export function firstValidPrice(
  values: (number | null)[],
  upToIdx: number
): number | null {
  const end = Math.min(upToIdx, values.length - 1);
  for (let i = 0; i <= end; i++) {
    const v = values[i];
    if (v != null && v > 0) return v;
  }
  return null;
}

export function portfolioValue(
  values: (number | null)[],
  idx: number,
  initialCapital: number
): number | null {
  const first = firstValidPrice(values, idx);
  const cur = values[idx];
  if (first == null || first <= 0 || cur == null || cur <= 0) return null;
  return initialCapital * (cur / first);
}

export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "-";
  if (Math.abs(n) >= 1_000_000)
    return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 10_000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function formatSignedMoney(n: number): string {
  if (!Number.isFinite(n)) return "-";
  const abs = formatMoney(Math.abs(n));
  return n >= 0 ? `+${abs}` : `-${abs}`;
}

export function formatPct(n: number): string {
  if (!Number.isFinite(n)) return "-";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

/* ---------- 字幕 ---------- */

export type SubtitleCue = {
  id: string;
  text: string;
  showOnStop: boolean;
  startDate: string;
  endDate: string;
  fontSize: number;
  x: number;
  y: number;
  color: string;
  align: "left" | "center" | "right";
};

export function newSubtitleCue(partial?: Partial<SubtitleCue>): SubtitleCue {
  return {
    id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text: "{date}\n{pnlLines}",
    /** 默认播放中也显示；勾选后才「仅停止时」 */
    showOnStop: false,
    startDate: "",
    endDate: "",
    fontSize: 26,
    x: 50,
    y: 86,
    color: "#e6edf3",
    align: "center",
    ...partial,
  };
}

/**
 * 显示态可见性：
 * - 填了时间轴：当前日期落在区间内则显示
 * - 仅「停止时」且无时间轴：暂停/播完才显示
 * - 两者都未限制：播放与暂停均显示（编辑退出后仍在）
 */
export function visibleSubtitles(
  cues: SubtitleCue[],
  opts: { date: string; playing: boolean; atEnd: boolean; stopped: boolean }
): SubtitleCue[] {
  const isStopped = (opts.stopped || opts.atEnd) && !opts.playing;
  return cues.filter((c) => {
    const text = c.text.trim();
    if (!text) return false;

    const hasRange = Boolean(c.startDate || c.endDate);
    if (hasRange) {
      // 尚无当前日期时先显示，避免加载瞬间闪没
      if (!opts.date) return true;
      const start = c.startDate || "0000-01-01";
      const end = c.endDate || "9999-12-31";
      return opts.date >= start && opts.date <= end;
    }

    if (c.showOnStop) return isStopped;
    return true;
  });
}

export type SubtitleInterpCtx = {
  date: string;
  capital: number;
  /** 当前显示的资产标签；各自按起始金额独立计盈亏 */
  labels: string[];
  priceOf: (label: string) => number | null;
  valueOf: (label: string, capital: number) => number | null;
};

export const SUBTITLE_TOKEN_HELP = [
  { token: "{date}", tip: "当前日期 YYYY-MM-DD" },
  { token: "{time}", tip: "当前时间（日线同日期）" },
  { token: "{capital}", tip: "起始金额" },
  { token: "{pnlLines}", tip: "各资产：盈亏（盈亏率）多行" },
  { token: "{leader}", tip: "涨幅领先资产名" },
  { token: "{price:BTC}", tip: "指定资产现价" },
  { token: "{value:BTC}", tip: "指定资产市值（按起始金额）" },
  { token: "{pnl:BTC}", tip: "指定资产盈亏金额" },
  { token: "{pnlPct:BTC}", tip: "指定资产盈亏率" },
] as const;

function resolveLabel(name: string, labels: string[]): string | null {
  const n = name.trim();
  if (!n) return null;
  const exact = labels.find((l) => l === n);
  if (exact) return exact;
  const ci = labels.find((l) => l.toUpperCase() === n.toUpperCase());
  return ci ?? null;
}

/** 单资产一行：名：盈亏（盈亏率） */
function formatAssetPnlLine(
  label: string,
  value: number | null,
  capital: number
): string {
  if (value == null || capital <= 0) return `${label}：-`;
  const pnl = value - capital;
  const pct = (value / capital - 1) * 100;
  return `${label}：${formatSignedMoney(pnl)}（${formatPct(pct)}）`;
}

/** 字幕插值：`{date}` `{pnlLines}` `{pnl:BTC}` 等 */
export function interpolateSubtitle(template: string, ctx: SubtitleInterpCtx): string {
  const labels = ctx.labels;
  const cap = ctx.capital;

  const lines = labels.map((lab) =>
    formatAssetPnlLine(lab, ctx.valueOf(lab, cap), cap)
  );
  const pnlLines = lines.length ? lines.join("\n") : "-";

  const pcts: Array<{ label: string; pct: number }> = [];
  for (const lab of labels) {
    const v = ctx.valueOf(lab, cap);
    if (v != null && cap > 0) pcts.push({ label: lab, pct: (v / cap - 1) * 100 });
  }
  const leader = [...pcts].sort((a, b) => b.pct - a.pct)[0]?.label ?? "-";

  const [y, m, d] = ctx.date.split("-");

  return template.replace(/\{([^{}]+)\}/g, (_, raw: string) => {
    const key = raw.trim();
    if (key === "date" || key === "time") return ctx.date || "-";
    if (key === "yyyy") return y || "-";
    if (key === "mm") return m || "-";
    if (key === "dd") return d || "-";
    if (key === "capital") return formatMoney(cap);
    if (key === "pnlLines" || key === "pnl" || key === "lines") return pnlLines;
    if (key === "leader") return leader;

    const mPrice = /^price:(.+)$/i.exec(key);
    if (mPrice) {
      const lab = resolveLabel(mPrice[1], labels);
      if (!lab) return "-";
      const p = ctx.priceOf(lab);
      return p == null ? "-" : p.toLocaleString(undefined, { maximumFractionDigits: 4 });
    }
    const mVal = /^value:(.+)$/i.exec(key);
    if (mVal) {
      const lab = resolveLabel(mVal[1], labels);
      if (!lab) return "-";
      const v = ctx.valueOf(lab, cap);
      return v == null ? "-" : formatMoney(v);
    }
    const mPnl = /^pnl:(.+)$/i.exec(key);
    if (mPnl) {
      const lab = resolveLabel(mPnl[1], labels);
      if (!lab) return "-";
      // 整行：名：盈亏（盈亏率）
      return formatAssetPnlLine(lab, ctx.valueOf(lab, cap), cap);
    }
    const mPct = /^pnlPct:(.+)$/i.exec(key);
    if (mPct) {
      const lab = resolveLabel(mPct[1], labels);
      if (!lab) return "-";
      const v = ctx.valueOf(lab, cap);
      return v == null || cap <= 0 ? "-" : formatPct((v / cap - 1) * 100);
    }
    return `{${raw}}`;
  });
}
