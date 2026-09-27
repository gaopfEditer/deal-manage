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

export function saveTradeDraft(exchange: Exchange, trade: TradeInput): boolean {
  try {
    localStorage.setItem(`${TRADE_PREFIX}${exchange}`, JSON.stringify(trade));
    return true;
  } catch {
    return false;
  }
}

export function loadInitialTrade(exchange: Exchange): TradeInput {
  const draft = loadTradeDraft(exchange);
  const empty: TradeInput = {
    symbol: "",
    market: "swap",
    side: "long",
    leverage: 0,
    status: "closed",
    entry: 0,
    exit: 0,
    time: "",
    nickname: "",
    inviteCode: "",
  };
  return draft ? { ...empty, ...draft } : empty;
}
