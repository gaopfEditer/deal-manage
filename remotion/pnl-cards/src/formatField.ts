import { calcPnlPct, formatPnl, formatPriceDisplay } from "./calc";
import type { Exchange, FieldId, TextField, TradeInput } from "./types";

export function sideLabel(side: TradeInput["side"]): string {
  return side === "long" ? "做多" : "做空";
}

export function marketLabel(market: TradeInput["market"]): string {
  return market === "swap" ? "永续" : "现货";
}

export function statusLabel(status: TradeInput["status"]): string {
  return status === "open" ? "持仓中" : "已平仓";
}

/** 各交易所开仓价标签 */
export function entryPriceLabel(exchange: Exchange): string {
  switch (exchange) {
    case "binance":
      return "开仓价格";
    case "gate":
    case "okx":
    case "bitget":
    default:
      return "开仓均价";
  }
}

/** 各交易所平仓/标记价标签（随持仓状态） */
export function exitPriceLabel(
  exchange: Exchange,
  status: TradeInput["status"]
): string {
  if (status === "open") {
    switch (exchange) {
      case "gate":
      case "binance":
        return "最新价格";
      case "okx":
      case "bitget":
      default:
        return "标记价格";
    }
  }
  switch (exchange) {
    case "gate":
      return "平仓均价";
    case "binance":
      return "平均平仓价";
    case "okx":
    case "bitget":
    default:
      return "平仓价格";
  }
}

/** 出图页永远跟随表单，不受模板固定文本影响 */
export const EXPORT_DATA_FIELD_IDS = new Set<FieldId>([
  "pnlPct",
  "entry",
  "entryLabel",
  "exit",
  "exitLabel",
]);

/** 字段正文（不含前缀/后缀） */
export function resolveFieldBody(
  field: TextField,
  trade: TradeInput,
  pnlPct: number,
  exchange: Exchange = "okx"
): string {
  if (field.text !== undefined && !EXPORT_DATA_FIELD_IDS.has(field.id)) {
    return field.text;
  }

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
    case "entryLabel":
      return entryPriceLabel(exchange);
    case "exit":
      return formatPriceDisplay(trade.exit);
    case "exitLabel":
      return exitPriceLabel(exchange, trade.status);
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
  pnlPct: number,
  exchange: Exchange = "okx"
): string {
  const raw = resolveFieldBody(field, trade, pnlPct, exchange);
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
  return calcPnlPct(
    trade.side,
    trade.entry,
    trade.exit,
    trade.leverage,
    trade.market
  );
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
