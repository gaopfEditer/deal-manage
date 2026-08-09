/** 指数日线：A 股走腾讯分段历史，美股走新浪（经 Vite 代理） */

import type { DailyPoint } from "./binanceDaily";
import { fetchTencentCnDailyCloses } from "./tencentDaily";

type Market = "us" | "cn";

function normalizeSinaSymbol(symbol: string): { market: Market; code: string } {
  const s = symbol.trim();
  const upper = s.toUpperCase();

  if (
    s === "^IXIC" ||
    upper === "IXIC" ||
    upper === "NASDAQ" ||
    upper === ".IXIC"
  ) {
    return { market: "us", code: ".IXIC" };
  }
  if (
    upper === "000300.SS" ||
    upper === "000300" ||
    upper === "HS300" ||
    upper === "SH000300"
  ) {
    return { market: "cn", code: "sh000300" };
  }
  if (s.startsWith(".")) return { market: "us", code: s };
  if (/^(sh|sz)\d{6}$/i.test(s)) return { market: "cn", code: s.toLowerCase() };
  if (/^\d{6}\.(SS|SZ)$/i.test(s)) {
    const [code, mkt] = s.split(".");
    return {
      market: "cn",
      code: `${mkt.toUpperCase() === "SS" ? "sh" : "sz"}${code}`,
    };
  }
  // 默认美股代码
  if (/^[A-Za-z.^]/.test(s)) return { market: "us", code: s.replace(/^\^/, ".") };
  return { market: "cn", code: s };
}

function inRange(date: string, startDate: string, endDate: string): boolean {
  return date >= startDate && date <= endDate;
}

async function fetchCnDaily(
  code: string,
  startDate: string,
  endDate: string
): Promise<DailyPoint[]> {
  // 新浪 A 股接口仅约最近 1023 根；改用腾讯按起止日期分段拉全量
  return fetchTencentCnDailyCloses(code, startDate, endDate);
}

async function fetchUsDaily(
  code: string,
  startDate: string,
  endDate: string
): Promise<DailyPoint[]> {
  const url =
    `/sina-us/usstock/api/json.php/US_MinKService.getDailyK` +
    `?symbol=${encodeURIComponent(code)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${code} 新浪美股失败 ${res.status}: ${text.slice(0, 100)}`);
  }
  const rows = (await res.json()) as Array<{
    d?: string;
    c?: string;
  }>;
  if (!Array.isArray(rows)) throw new Error(`${code} 新浪返回异常`);
  return rows
    .map((r) => {
      const date = String(r.d ?? "");
      const close = Number(r.c);
      if (!date || !Number.isFinite(close)) return null;
      return { date, close };
    })
    .filter((p): p is DailyPoint => p != null && inRange(p.date, startDate, endDate));
}

/**
 * 新浪日线收盘价。
 * 示例：.IXIC / ^IXIC（纳斯达克）、sh000300 / 000300.SS（沪深300）
 */
export async function fetchSinaDailyCloses(
  symbol: string,
  startDate: string,
  endDate: string
): Promise<DailyPoint[]> {
  const { market, code } = normalizeSinaSymbol(symbol);
  const points =
    market === "cn"
      ? await fetchCnDaily(code, startDate, endDate)
      : await fetchUsDaily(code, startDate, endDate);

  const map = new Map<string, number>();
  for (const p of points) map.set(p.date, p.close);
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, close]) => ({ date, close }));
}
