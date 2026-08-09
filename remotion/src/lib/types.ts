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

/** 片头收益封面（交易数字优先从 project.trade 注入） */
export type PnlCoverLayer = TimelineLayerBase & {
  type: "pnl_cover";
  props: {
    symbol?: string;
    title?: string;
    subtitle?: string;
    side?: "long" | "short";
    /** 侧标，默认多单/空单 */
    tag?: string;
    returnPercent?: number;
    profit?: number;
    entryValue?: number;
    /** 发车时间文案，第一帧展示 */
    entryTime?: string;
    /** 入场价（hydrate 后可取） */
    entryPrice?: number;
    /** 出场价（hydrate 后可取） */
    exitPrice?: number;
    /** 杠杆，默认 20 */
    leverage?: number;
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
  /** tip=K 线顶端（高点）+ 箭头气泡；bottom=底端；未设则按 direction */
  anchor?: "tip" | "bottom";
  /** 使用箭头+气泡样式（默认 tip 锚定时开启） */
  style?: "pin" | "arrow";
};

/** JSON 中 callouts / arrows 项：可用 palette；可用 index 或 time 定位 */
export type TradingViewKlineCalloutInput = {
  /** 第几根 K（0-based）；与 time 二选一 */
  index?: number;
  /** 匹配 categories 时间标签，如 `05-14 16:00` 或 ISO */
  time?: string;
  text: string;
  palette?: "red" | "green" | "cyan" | "orange" | "purple" | "pink";
  color?: string;
  textColor?: string;
  /** up=挂高点，down=挂低点；也可用 anchor */
  direction?: "up" | "down";
  /** tip=指定 K 线顶端，bottom=底端（优先于 direction） */
  anchor?: "tip" | "bottom";
  style?: "pin" | "arrow";
};

/** 按起止时间动态拉 K（calculateMetadata 阶段 hydrate 成 bars） */
export type TradingViewKlineDynamicFetch = {
  source?: "binance";
  symbol: string;
  interval: string;
  start: string;
  end: string;
  warmupBars?: number;
};

/** 价格基准：上车价 / 止盈价 */
export type TradingViewPriceRelativeTo = "entry" | "takeProfit";

/**
 * 价格：绝对值，或相对某基准价的百分比。
 * - 默认相对 `entry`（上车价），如止损 `{ "offsetPercent": -6 }`、止盈线 `{ "offsetPercent": 12 }`
 * - 也可相对止盈价：`{ "offsetPercent": 0.5, "relativeTo": "takeProfit" }`
 */
export type TradingViewPriceRef =
  | number
  | {
      price?: number;
      /** 相对基准价的涨跌幅 %（多单止损多为负，止盈线多为正） */
      offsetPercent?: number;
      /** 百分比基准；默认 entry */
      relativeTo?: TradingViewPriceRelativeTo;
    };

/**
 * 工程级交易快照：片头 pnl_cover 与 K 线 signals 共用，只在此处维护一处。
 * calculateMetadata 阶段会 apply 到对应 timeline 层。
 */
export type ProjectTrade = {
  /** 展示用币种，如 ETH */
  symbol: string;
  /** K 线顶栏文案，如 以太坊/美元 */
  symbolLabel?: string;
  /** 交易所交易对，如 ETHUSDT */
  pair?: string;
  side?: "long" | "short";
  tag?: string;
  title?: string;
  subtitle?: string;
  timeframe?: string;
  entry: {
    time: string;
    /** 数字价，或「市价」——hydrate 后按该时刻 K 线收盘价回填 */
    price?: number | string;
    label?: string;
  };
  takeProfit?: {
    time: string;
    price?: number | string;
    label?: string;
  };
  takeProfitLine?: TradingViewPriceRef;
  stopLossLine?: TradingViewPriceRef;
  /** 开仓价值（按保证金计；收获 = 开仓价值 × 价格涨跌 × 杠杆） */
  notional?: number;
  entryValue?: number;
  /** 杠杆倍数，默认 20 */
  leverage?: number;
  returnPercent?: number;
  profit?: number;
  /** 出场价（可由 K 线回填） */
  exitPrice?: number;
  settlementLabel?: string;
  settlementHoldSeconds?: number;
  /**
   * 动态 K 线。
   * - interval：支持 15min / 15m / 1h / 1d 等
   * - start/end：可省略，默认按入场/出场时间向外扩展 padRatio（默认 20%）
   */
  kline?: {
    source?: "binance";
    interval: string;
    start?: string;
    end?: string;
    /** 相对入场↔出场跨度的外扩比例，默认 0.2 */
    padRatio?: number;
    /**
     * 指标预热根数（Vegas / 布林）。向前多拉但不展示；
     * 默认至少 169，保证展示区首根起布林带完整。
     */
    warmupBars?: number;
  };
};

/** 结算摘要：开仓价值 / 收获 / 收益率（可手填，缺省按止盈价推算） */
export type TradingViewSettlementInput = {
  /** 标题，默认「结算」 */
  label?: string;
  /** 开仓名义价值（USDT），默认 10000 */
  notional?: number;
  /** 出场价；默认止盈线/止盈点价格 */
  exitPrice?: number;
  /** 覆盖：开仓价值 */
  entryValue?: number;
  /** 覆盖：收获（盈亏金额） */
  profit?: number;
  /** 覆盖：收益率 % */
  returnPercent?: number;
  /** 结算卡在片尾停留秒数，默认 5 */
  holdSeconds?: number;
};

/** 发车信号：上车点、止盈点、止盈/止损线 */
export type TradingViewSignalPlanInput = {
  side?: "long" | "short";
  /** 上车点（必填 time 或 index） */
  entry: {
    time?: string;
    index?: number;
    price?: number;
    label?: string;
  };
  /** 止盈点标记（落在某根 K 上） */
  takeProfit?: {
    time?: string;
    index?: number;
    price?: number;
    label?: string;
  };
  /** 止盈水平线 */
  takeProfitLine?: TradingViewPriceRef;
  /** 止损水平线 */
  stopLossLine?: TradingViewPriceRef;
  /** 线起点：time / index，默认上车点 */
  lineFrom?: string | number;
  /** 线终点：time / index，默认最后一根或止盈点 */
  lineTo?: string | number;
  /** 片尾结算：开仓价值 / 收获 / 收益率 */
  settlement?: TradingViewSettlementInput | true;
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
  /**
   * 动态接入：给 start/end 后由 calculateMetadata 拉取 bars。
   * 与静态 bars 同时存在时以 dynamic 为准（hydrate 后覆盖 bars）。
   */
  dynamic?: TradingViewKlineDynamicFetch;
  /** 推荐：与 kkkline.html 相同的 bars 行格式（仅展示窗口，不含预热） */
  bars?: TradingViewKlineBar[];
  /**
   * 展示窗口之前的收盘价：只参与布林带等指标预热，不画 K 线。
   * hydrate 动态拉取时由 warmupBars 自动填充。
   */
  indicatorSeedCloses?: number[];
  /** 分拆写法（与 bars 二选一） */
  categories?: string[];
  ohlc?: number[][];
  volumes?: number[];
  vegas144?: number[];
  vegas169?: number[];
  callouts?: TradingViewKlineCalloutInput[];
  /**
   * 箭头气泡：指向指定 K 线顶端（anchor: tip）或底端。
   * 可用 index 或 time；语义同 callouts，默认 tip + arrow 样式。
   */
  arrows?: TradingViewKlineCalloutInput[];
  /** 发车信号：上车点 / 止盈点 / 止盈止损线 */
  signals?: TradingViewSignalPlanInput;
  /** 布林带；默认开启 period=20 stdDev=2；传 false 关闭 */
  bollinger?: false | { period?: number; stdDev?: number };
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
  | PnlCoverLayer
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
  /** 统一交易数据（片头 + K 线信号） */
  trade?: ProjectTrade;
  timeline: TimelineLayer[];
};
