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

export type AiAssistantCatLayer = TimelineLayerBase & {
  type: "ai_assistant_cat";
  props: {
    action?: string;
    position?: SemanticPosition | string;
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
    audio?: string;
    theme?: string;
  };
  timeline: TimelineLayer[];
};
