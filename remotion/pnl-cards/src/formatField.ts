import { calcPnlPct, formatPnl, formatPriceDisplay } from "./calc";
import type { FieldId, TextField, TradeInput } from "./types";

export function sideLabel(side: TradeInput["side"]): string {
  return side === "long" ? "做多" : "做空";
}

export function marketLabel(market: TradeInput["market"]): string {
  return market === "swap" ? "永续" : "现货";
}

export function statusLabel(status: TradeInput["status"]): string {
  return status === "open" ? "持仓中" : "已平仓";
}

/** 字段正文（不含前缀/后缀） */
export function resolveFieldBody(
  field: TextField,
  trade: TradeInput,
  pnlPct: number
): string {
  if (field.text !== undefined) return field.text;

  switch (field.id) {
    case "custom":
      return "";
    case "symbol":
      return trade.symbol.trim();
    case "symbolTitle": {
      const sym = trade.symbol.trim();
      if (!sym) return "";
      const m = trade.market === "swap" ? "永续合约" : "现货";
      return `${sym} ${m}`;
    }
    case "marketLabel":
      return marketLabel(trade.market);
    case "side":
      return sideLabel(trade.side);
    case "sideRow": {
      const parts: string[] = [sideLabel(trade.side)];
      if (trade.leverage > 0) parts.push(`${trade.leverage}x`);
      parts.push(statusLabel(trade.status));
      return parts.join(" ");
    }
    case "leverage":
      return trade.leverage > 0 ? String(trade.leverage) : "";
    case "status":
      return statusLabel(trade.status);
    case "pnlPct":
      return trade.entry > 0 && trade.exit > 0 ? formatPnl(pnlPct) : "";
    case "entry":
      return formatPriceDisplay(trade.entry);
    case "exit":
      return formatPriceDisplay(trade.exit);
    case "time":
      return trade.time?.trim() ?? "";
    case "nickname":
      return trade.nickname?.trim() ?? "";
    case "inviteCode":
      return trade.inviteCode?.trim() ?? "";
    default:
      return "";
  }
}

export function resolveFieldText(
  field: TextField,
  trade: TradeInput,
  pnlPct: number
): string {
  const raw = resolveFieldBody(field, trade, pnlPct);
  if (!raw) return "";
  const prefix = field.prefix ?? "";
  const suffix = field.suffix ?? "";
  return `${prefix}${raw}${suffix}`;
}

export function resolveFieldColor(
  field: TextField,
  pnlPct: number,
  pnlUpColor: string,
  pnlDownColor: string
): string {
  if (field.color === "pnl") {
    if (pnlPct > 0) return pnlUpColor;
    if (pnlPct < 0) return pnlDownColor;
    return pnlUpColor;
  }
  return field.color;
}

export function computePnl(trade: TradeInput): number {
  return calcPnlPct(trade.side, trade.entry, trade.exit, trade.leverage);
}

/** 可添加的字段类型（不含 custom，custom 单独入口） */
export const ALL_FIELD_IDS: FieldId[] = [
  "symbol",
  "marketLabel",
  "side",
  "leverage",
  "status",
  "pnlPct",
  "entry",
  "exit",
  "time",
  "nickname",
  "inviteCode",
];
