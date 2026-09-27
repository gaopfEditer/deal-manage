import type { Exchange } from "./types";

/** 各交易所默认底图（优先使用 public/backgrounds 下现有 JPG） */
export const DEFAULT_BG: Record<Exchange, string> = {
  okx: "/operate-gate/backgrounds/okx.jpg",
  gate: "/operate-gate/backgrounds/gate.jpg",
  binance: "/operate-gate/backgrounds/binance.jpg",
  bitget: "/operate-gate/backgrounds/bitget.png",
};

/** 旧模板里 .png 路径 → 现有 .jpg */
const BG_PATH_MIGRATIONS: Record<string, string> = {
  "/operate-gate/backgrounds/okx.png": DEFAULT_BG.okx,
  "/operate-gate/backgrounds/gate.png": DEFAULT_BG.gate,
  "/operate-gate/backgrounds/binance.png": DEFAULT_BG.binance,
};

export function migrateBgPath(bg: string | undefined, exchange: Exchange): string {
  const trimmed = bg?.trim() ?? "";
  if (!trimmed) return DEFAULT_BG[exchange];
  return BG_PATH_MIGRATIONS[trimmed] ?? trimmed;
}
