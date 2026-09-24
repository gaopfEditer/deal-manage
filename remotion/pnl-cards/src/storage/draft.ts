import type { Exchange, TradeInput } from "../types";

const TRADE_PREFIX = "pnl-card-trade:";
const PREFS_KEY = "pnl-card-prefs";

export type AppMode = "export" | "editor";

export type AppPrefs = {
  mode: AppMode;
  exchange: Exchange;
};

export function loadPrefs(): AppPrefs | null {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AppPrefs;
  } catch {
    return null;
  }
}

export function savePrefs(prefs: AppPrefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export function loadTradeDraft(exchange: Exchange): TradeInput | null {
  try {
    const raw = localStorage.getItem(`${TRADE_PREFIX}${exchange}`);
    if (!raw) return null;
    return JSON.parse(raw) as TradeInput;
  } catch {
    return null;
  }
}

export function saveTradeDraft(exchange: Exchange, trade: TradeInput): void {
  localStorage.setItem(`${TRADE_PREFIX}${exchange}`, JSON.stringify(trade));
}
