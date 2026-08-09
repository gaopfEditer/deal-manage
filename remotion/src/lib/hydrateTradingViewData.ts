import { fetchTradingViewBarsDynamic } from "./fetchTradingViewKlines";
import {
  getTradeKlineCache,
  initTradeRecentCache,
  setTradeKlineCache,
  touchTradeSymbol,
} from "./tradeRecentCache";
import type { TimelineLayer, TradingViewKlineDataInput, VideoProject } from "./types";

function needsDynamicFetch(data: TradingViewKlineDataInput | undefined): boolean {
  return Boolean(data?.dynamic?.symbol && data.dynamic.start && data.dynamic.end);
}

async function hydrateOne(data: TradingViewKlineDataInput): Promise<TradingViewKlineDataInput> {
  if (!needsDynamicFetch(data) || !data.dynamic) return data;
  const { symbol, interval, start, end } = data.dynamic;
  touchTradeSymbol(symbol);

  const cached = getTradeKlineCache(symbol, interval, start, end);
  if (cached?.bars.length) {
    return {
      ...data,
      bars: cached.bars,
      indicatorSeedCloses: cached.indicatorSeedCloses,
      categories: undefined,
      ohlc: undefined,
      volumes: undefined,
      vegas144: undefined,
      vegas169: undefined,
    };
  }

  const { bars, indicatorSeedCloses } = await fetchTradingViewBarsDynamic(data.dynamic);
  setTradeKlineCache(symbol, interval, start, end, bars, indicatorSeedCloses);
  return {
    ...data,
    bars,
    indicatorSeedCloses,
    categories: undefined,
    ohlc: undefined,
    volumes: undefined,
    vegas144: undefined,
    vegas169: undefined,
  };
}

async function hydrateLayer(layer: TimelineLayer): Promise<TimelineLayer> {
  if (layer.type !== "echart_panel") return layer;
  const tv = layer.props.tradingViewData;
  if (!needsDynamicFetch(tv)) return layer;
  const tradingViewData = await hydrateOne(tv!);
  return {
    ...layer,
    props: {
      ...layer.props,
      tradingViewData,
    },
  };
}

/** 在 calculateMetadata 阶段把 dynamic 起止时间解析成 bars（带本地最近操作缓存） */
export async function hydrateProjectTradingViewData(
  project: VideoProject
): Promise<VideoProject> {
  await initTradeRecentCache();
  if (project.trade?.pair || project.trade?.symbol) {
    touchTradeSymbol(project.trade.pair || project.trade.symbol);
  }
  const timeline = await Promise.all(project.timeline.map(hydrateLayer));
  return { ...project, timeline };
}
