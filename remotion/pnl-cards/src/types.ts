export type Exchange = "okx" | "gate" | "binance" | "bitget";

export type FieldId =
  | "symbol"
  | "symbolTitle"
  | "marketLabel"
  | "side"
  | "sideRow"
  | "leverage"
  | "status"
  | "pnlPct"
  | "entry"
  | "exit"
  | "time"
  | "nickname"
  | "inviteCode"
  | "custom";

export type TemplateConstraints = {
  pnlMinRatio?: number;
};

export interface TextField {
  /** 实例唯一键（同类型可有多份） */
  key: string;
  id: FieldId;
  x: number;
  y: number;
  fontSize: number;
  fontWeight: number;
  fontFamily?: string;
  /** 固定色，或 "pnl" 表示按涨跌变色 */
  color: string;
  align: "left" | "center" | "right";
  letterSpacing?: string;
  prefix?: string;
  suffix?: string;
  /** 固定文案；有值时优先于表单/自动计算（undefined 表示跟随数据） */
  text?: string;
}

/** 叠加图层（如头像 PNG） */
export interface ImageLayer {
  key: string;
  kind: "avatar";
  x: number;
  y: number;
  width: number;
  height: number;
  /** 模板占位；出图时由 TradeInput.avatarUrl 覆盖 */
  src?: string;
  /** 圆角 px；≥9999 视为圆形 */
  borderRadius?: number;
}

export type EditorSelection =
  | { kind: "field"; key: string }
  | { kind: "image"; key: string };

export interface CardTemplate {
  exchange: Exchange;
  /** 如 /operate-gate/backgrounds/okx.png */
  bg: string;
  /** 画布宽（导出尺寸 & 字段坐标系） */
  width: number;
  /** 画布高 */
  height: number;
  /** 底图原始像素宽；缺省同 width */
  bgWidth?: number;
  /** 底图原始像素高；缺省同 height */
  bgHeight?: number;
  fields: TextField[];
  /** 头像等叠加图，渲染在文字之上 */
  images?: ImageLayer[];
  pnlUpColor: string;
  pnlDownColor: string;
  constraints?: TemplateConstraints;
}

export interface TradeInput {
  symbol: string;
  market: "swap" | "spot";
  side: "long" | "short";
  leverage: number;
  status: "open" | "closed";
  entry: number;
  exit: number;
  time?: string;
  nickname?: string;
  inviteCode?: string;
  /** 出图时覆盖模板中的头像图层 */
  avatarUrl?: string;
}

export const FIELD_LABELS: Record<FieldId, string> = {
  symbol: "品种",
  symbolTitle: "品种标题",
  marketLabel: "市场",
  side: "方向",
  sideRow: "方向+杠杆+状态",
  leverage: "杠杆",
  status: "状态",
  pnlPct: "收益率",
  entry: "开仓价",
  exit: "平仓/标记价",
  time: "时间",
  nickname: "昵称",
  inviteCode: "邀请码",
  custom: "自定义文本",
};

export const EXCHANGES: { id: Exchange; label: string }[] = [
  { id: "okx", label: "OKX" },
  { id: "gate", label: "Gate" },
  { id: "binance", label: "币安" },
  { id: "bitget", label: "Bitget" },
];
