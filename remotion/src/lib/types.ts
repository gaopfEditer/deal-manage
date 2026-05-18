export type SemanticPosition =
  | "top_left"
  | "top_center"
  | "top_right"
  | "center"
  | "bottom_left"
  | "bottom_center"
  | "bottom_right";

export type TimelineLayerBase = {
  startFrame: number;
  endFrame: number;
};

export type TextAnnotationLayer = TimelineLayerBase & {
  type: "text_annotation";
  props: {
    content: string;
    style?: Record<string, string | number>;
    animation?: string;
  };
};

export type ChatParticipant = {
  /** 唯一 id，与 messages[].from 对应 */
  id: string;
  nickname: string;
  /** emoji、公网 URL，或相对 public/ 的路径 */
  avatar?: string;
};

export type ChatMessageKind = "text" | "image" | "red_packet" | "emoji";

export type ChatMessage = {
  from: string;
  kind?: ChatMessageKind;
  content: string;
  /** 气泡旁时间文案，可空 */
  time?: string;
  /** 距上一条出现后的等待毫秒，默认 1000 */
  delayMs?: number;
};

export type AiAssistantCatLayer = TimelineLayerBase & {
  type: "ai_assistant_cat";
  props: {
    /** 己方 id，气泡在右侧；未设时取 participants[0] */
    selfId?: string;
    participants: ChatParticipant[];
    messages: ChatMessage[];
    defaultDelayMs?: number;
    /** 聊天面板标题，可空 */
    title?: string;
    position?: SemanticPosition | string;
    /** @deprecated 旧版单句；无 messages 时自动转成一条对话 */
    action?: string;
    dialog?: string;
  };
};

/** 内置 SVG：趋势箭头 / K 线示意；也可用任意字符串作占位标签 */
export type IconBadgeLayer = TimelineLayerBase & {
  type: "icon_badge";
  props: {
    icon:
      | "trend_up"
      | "trend_down"
      | "kline_up"
      | "kline_down"
      | "line_up"
      | "line_down"
      | "bar_up"
      | "bar_down"
      | string;
    label?: string;
    size?: number;
    position?: SemanticPosition | string;
    style?: Record<string, string | number>;
  };
};

/**
 * 维加斯通道（常用实现：两条不同周期 EMA 作为上下轨；渲染为双 EMA 线）。
 * 周期默认 144 / 169；K 根数较少时会自动压缩到可算范围。
 */
export type VegasChannelProps = {
  enabled?: boolean;
  emaPeriod1?: number;
  emaPeriod2?: number;
  /** 是否在双轨之间做浅色填充（band） */
  fill?: boolean;
};

/**
 * 射击之星：优先用上游给出的 K 线索引做 markPoint；
 * `autoDetect` 为简易启发式（演示用），不等同专业行情软件识别。
 */
export type ShootingStarProps = {
  /** 与当前图 x 轴类目顺序一致的 0-based 索引 */
  indices?: number[];
  autoDetect?: boolean;
  label?: string;
};

/** K 线形态气泡标注（kkkline.html：pin 指向 K 线，up=挂高点下指，down=挂低点上指） */
export type KlineCallout = {
  index: number;
  text: string;
  color?: string;
  textColor?: string;
  direction?: "up" | "down";
};

/** JSON 中 callouts 项：可用 palette 键或自定义 color */
export type TradingViewKlineCalloutInput = {
  index: number;
  text: string;
  palette?: "red" | "green" | "cyan" | "orange" | "purple" | "pink";
  color?: string;
  textColor?: string;
  direction?: "up" | "down";
};

/**
 * 与 remotion/kkkline.html 的 rawData 每行一致：
 * [时间, 开, 收, 低, 高, 量, Vegas144, Vegas169, 信号文本|null, 颜色|null, up|down|null]
 */
export type TradingViewKlineBar = [
  string,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  string | null,
  string | null,
  ("up" | "down") | null,
];

/** 工程 JSON 内嵌的 K 线数据（逻辑在 echartEthKlinePreset.ts / echartTradingViewOption.ts） */
export type TradingViewKlineDataInput = {
  symbol: string;
  timeframe: string;
  vegasLegend?: string;
  /** 推荐：与 kkkline.html 相同的 bars 行格式 */
  bars?: TradingViewKlineBar[];
  /** 分拆写法（与 bars 二选一） */
  categories?: string[];
  ohlc?: number[][];
  volumes?: number[];
  vegas144?: number[];
  vegas169?: number[];
  callouts?: TradingViewKlineCalloutInput[];
  showLastPriceArrow?: boolean;
  lastPrice?: number;
  change?: number;
  changePercent?: number;
};

/** ECharts：折线 / 柱状 / K 线；trend 控制配色与演示数据走向 */
export type EchartPanelLayer = TimelineLayerBase & {
  type: "echart_panel";
  props: {
    chart: "line" | "bar" | "candlestick";
    trend: "up" | "down";
    title?: string;
    position?: SemanticPosition | string;
    containerStyle?: Record<string, string | number>;
    vegasChannel?: VegasChannelProps;
    shootingStar?: ShootingStarProps;
    /** TradingView 深色全屏 K 线样式 */
    tradingViewStyle?: boolean;
    fullscreen?: boolean;
    /** K 线行情与标注数据（见 public/sample-project.json） */
    tradingViewData?: TradingViewKlineDataInput;
    /** 追加形态气泡（在 tradingViewData.callouts 之外） */
    callouts?: KlineCallout[];
  };
};

export type TimelineLayer =
  | TextAnnotationLayer
  | AiAssistantCatLayer
  | IconBadgeLayer
  | EchartPanelLayer;

export type VideoProject = {
  metadata: {
    fps: number;
    durationInFrames: number;
    width: number;
    height: number;
  };
  assets?: {
    /** 公网/内网 URL，或相对 `public/` 的文件名（如 `tts_output.mp3`，勿用仅 Studio 可访问的 localhost） */
    audio?: string;
    theme?: string;
  };
  timeline: TimelineLayer[];
};
