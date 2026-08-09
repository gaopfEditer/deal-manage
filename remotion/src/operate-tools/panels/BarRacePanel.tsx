import React, { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts/dist/echarts.js";
import { todayYmd } from "../../lib/binanceDaily";
import {
  getPriceCache,
  listPriceCacheKeys,
  makePriceCacheKey,
  PRICE_CACHE_MAX,
  priceCacheSize,
  setPriceCache,
} from "../../lib/priceCache";
import {
  ASSET_PRESETS,
  clonePresetLegs,
  formatMoney,
  interpolateSubtitle,
  loadMixedAssets,
  newAssetLeg,
  newSubtitleCue,
  portfolioValue,
  type AssetLeg,
  type AssetPresetId,
  type AssetSourceKind,
  type PriceSeriesPayload,
  type SubtitleCue,
  visibleSubtitles,
} from "../../lib/priceSource";
import { FloatingSubtitle } from "./FloatingSubtitle";

const COLORS = ["#f0883e", "#58a6ff", "#3fb950", "#d2a8ff", "#ff7b72", "#e3b341", "#79c0ff"];

const SAMPLE_CUSTOM_JSON = `{
  "dates": ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"],
  "series": {
    "自定义A": [100, 105, 98, 112, 120]
  }
}`;

/** 多来源组合赛马：播放波动 + 盈亏 + 插值字幕 */
export const BarRacePanel: React.FC = () => {
  const [legs, setLegs] = useState<AssetLeg[]>(() =>
    clonePresetLegs(ASSET_PRESETS[0])
  );
  /** 默认拉更长历史；BTC 交易所约 2017-08 起才有，会自动从首根 K 线接上 */
  const [startDate, setStartDate] = useState("2010-01-01");
  const [endDate, setEndDate] = useState(todayYmd());
  const [customJsonText, setCustomJsonText] = useState(SAMPLE_CUSTOM_JSON);
  const [showJson, setShowJson] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cacheHint, setCacheHint] = useState("");
  const [cacheTick, setCacheTick] = useState(0);
  /** 当前点选的快捷组合（仅选腿，不自动拉数） */
  const [activePreset, setActivePreset] = useState<AssetPresetId | null>("macro-mix");
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [initialCapital, setInitialCapital] = useState(1_000_000);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [payload, setPayload] = useState<PriceSeriesPayload | null>(null);

  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [speed, setSpeed] = useState(48);
  const [cues, setCues] = useState<SubtitleCue[]>([
    newSubtitleCue({
      text: "{date}\n{pnlLines}",
      showOnStop: false,
      startDate: "",
      endDate: "",
      fontSize: 22,
      x: 50,
      y: 82,
    }),
  ]);
  const [subtitleEdit, setSubtitleEdit] = useState(true);
  const [selectedCueId, setSelectedCueId] = useState<string | null>(null);
  /** 图表区域高度（px），可用滑条或底边拖拽调整 */
  const [chartHeight, setChartHeight] = useState(600);

  const chartRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const dragH = useRef<{ startY: number; startH: number } | null>(null);
  /** 防止「默认 起始」的慢请求覆盖后来改日期后的加载结果 */
  const loadSeq = useRef(0);

  const allSyms = useMemo(
    () => (payload ? Object.keys(payload.series) : []),
    [payload]
  );

  const activeSyms = useMemo(
    () => allSyms.filter((s) => enabled[s] !== false),
    [allSyms, enabled]
  );

  const atEnd = Boolean(payload && frameIdx >= payload.dates.length - 1);
  const currentDate = payload?.dates[frameIdx] ?? "";

  const interpCtx = useMemo(() => {
    const labels = activeSyms;
    return {
      date: currentDate,
      capital: initialCapital,
      labels,
      priceOf: (label: string) => {
        if (!payload) return null;
        const v = payload.series[label]?.[frameIdx];
        return v == null ? null : v;
      },
      valueOf: (label: string, capital: number) => {
        if (!payload) return null;
        return portfolioValue(payload.series[label] ?? [], frameIdx, capital);
      },
    };
  }, [payload, frameIdx, initialCapital, activeSyms, currentDate]);

  const playCues = useMemo(
    () =>
      visibleSubtitles(cues, {
        date: currentDate,
        playing,
        atEnd,
        stopped: stopped || (!playing && atEnd),
      }),
    [cues, currentDate, playing, atEnd, stopped]
  );

  const stageCues = subtitleEdit ? cues : playCues;

  const cachedRanges = useMemo(() => listPriceCacheKeys(), [cacheTick]);

  const pnlRows = useMemo(() => {
    if (!payload) return [];
    return activeSyms.map((sym, idx) => {
      const values = payload.series[sym];
      const price = values[frameIdx];
      const value = portfolioValue(values, frameIdx, initialCapital);
      const first = values.find((v) => v != null && v > 0) ?? null;
      const pnl = value != null ? value - initialCapital : null;
      const pnlPct =
        first != null && price != null && first > 0 ? (price / first - 1) * 100 : null;
      return {
        sym,
        color: COLORS[allSyms.indexOf(sym) % COLORS.length] ?? COLORS[idx % COLORS.length],
        price,
        value,
        pnl,
        pnlPct,
      };
    });
  }, [payload, activeSyms, frameIdx, initialCapital, allSyms]);

  useEffect(() => {
    if (!chartRef.current) return;
    chart.current = echarts.init(chartRef.current);
    const onResize = () => chart.current?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.resize();
  }, [chartHeight]);

  const onHeightDragStart = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragH.current = { startY: e.clientY, startH: chartHeight };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (!dragH.current) return;
      const next = Math.min(
        900,
        Math.max(240, dragH.current.startH + (ev.clientY - dragH.current.startY))
      );
      setChartHeight(next);
    };
    const up = () => {
      dragH.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const showToast = (kind: "ok" | "err", text: string) => {
    setToast({ kind, text });
    if (toastTimer.current != null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, 4200);
  };

  useEffect(() => {
    return () => {
      if (toastTimer.current != null) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const applyPayload = (data: PriceSeriesPayload) => {
    setPayload(data);
    setFrameIdx(0);
    setPlaying(false);
    setStopped(false);
    const nextEnabled: Record<string, boolean> = {};
    for (const s of Object.keys(data.series)) nextEnabled[s] = enabled[s] !== false;
    setEnabled(nextEnabled);
  };

  const applyPreset = (id: AssetPresetId) => {
    const preset = ASSET_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setActivePreset(id);
    setLegs(clonePresetLegs(preset));
    setStartDate(preset.startDate);
    setEndDate(todayYmd());
    setPayload(null);
    setError("");
    setCacheHint("");
    showToast("ok", `已选择「${preset.name}」，请点「加载组合」获取数据`);
  };

  /** 仅点击「加载组合」时拉取；同日期区间命中缓存则直接用（最多 5 组） */
  const load = async (opts?: { force?: boolean }) => {
    const seq = ++loadSeq.current;
    const sd = startDate;
    const ed = endDate || todayYmd();
    const legsSnap = legs.map((l) => ({ ...l }));
    const jsonSnap = customJsonText;
    const cacheKey = makePriceCacheKey(sd, ed, legsSnap);
    const presetName =
      ASSET_PRESETS.find((p) => p.id === activePreset)?.name ?? "当前组合";

    if (!opts?.force) {
      const cached = getPriceCache(cacheKey);
      if (cached) {
        if (seq !== loadSeq.current) return;
        applyPayload(cached);
        setError("");
        setCacheHint(`缓存命中 ${sd} → ${ed}（${priceCacheSize()}/${PRICE_CACHE_MAX}）`);
        setCacheTick((n) => n + 1);
        setLoading(false);
        showToast(
          "ok",
          `「${presetName}」已从缓存加载：${Object.keys(cached.series).length} 条资产 · ${cached.dates.length} 天`
        );
        return;
      }
    }

    setLoading(true);
    setError("");
    setCacheHint("");
    setPlaying(false);
    setStopped(false);
    try {
      const data = await loadMixedAssets({
        legs: legsSnap,
        startDate: sd,
        endDate: ed,
        customJsonText: jsonSnap,
      });
      if (seq !== loadSeq.current) return;
      setPriceCache(cacheKey, sd, ed, data);
      applyPayload(data);
      setCacheHint(`已缓存 ${sd} → ${ed}（${priceCacheSize()}/${PRICE_CACHE_MAX}）`);
      setCacheTick((n) => n + 1);
      showToast(
        "ok",
        `「${presetName}」数据已就绪：${Object.keys(data.series).length} 条资产 · ${data.dates.length} 天（${sd} → ${ed}）`
      );
    } catch (e) {
      if (seq !== loadSeq.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setPayload(null);
      setCacheHint("");
      showToast("err", `加载失败：${msg}`);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!playing || !payload || speed <= 0) return;
    const stride = Math.max(1, Math.ceil(speed / 40));
    const ticksPerSec = Math.max(1, speed / stride);
    const stepMs = Math.max(4, Math.round(1000 / ticksPerSec));
    const timer = window.setInterval(() => {
      setFrameIdx((i) => {
        if (i >= payload.dates.length - 1) {
          setPlaying(false);
          setStopped(true);
          return i;
        }
        return Math.min(i + stride, payload.dates.length - 1);
      });
    }, stepMs);
    return () => window.clearInterval(timer);
  }, [playing, payload, speed]);

  useEffect(() => {
    if (!chart.current || !payload) return;
    const end = Math.max(0, Math.min(frameIdx, payload.dates.length - 1));
    const dates = payload.dates;

    let yMin = Infinity;
    let yMax = -Infinity;
    for (const sym of activeSyms) {
      const vals = payload.series[sym];
      for (const v of vals) {
        if (v == null || !Number.isFinite(v)) continue;
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
      }
    }
    const hasY = Number.isFinite(yMin) && Number.isFinite(yMax);

    const series = activeSyms.map((sym) => {
      const idxColor = allSyms.indexOf(sym);
      const full = payload.series[sym];
      const data = full.map((v, i) => (i <= end ? v : null));
      return {
        name: sym,
        type: "line" as const,
        showSymbol: false,
        connectNulls: true,
        data,
        lineStyle: { width: 2.5, color: COLORS[idxColor % COLORS.length] },
        itemStyle: { color: COLORS[idxColor % COLORS.length] },
        endLabel: {
          show: true,
          formatter: "{a}",
          color: COLORS[idxColor % COLORS.length],
          fontSize: 11,
        },
      };
    });

    chart.current.setOption(
      {
        backgroundColor: "#0d1117",
        animation: false,
        legend: {
          top: 8,
          textStyle: { color: "#c9d1d9" },
          data: activeSyms,
        },
        tooltip: {
          trigger: "axis",
          backgroundColor: "rgba(22,27,34,0.95)",
          borderColor: "#30363d",
          textStyle: { color: "#e6edf3" },
          valueFormatter: (v: unknown) => {
            const n = Number(v);
            return Number.isFinite(n) ? n.toFixed(2) : "-";
          },
        },
        grid: { left: 64, right: 72, top: 48, bottom: 40 },
        xAxis: {
          type: "category",
          data: dates,
          boundaryGap: false,
          axisLabel: {
            color: "#8b949e",
            interval: Math.max(0, Math.floor(dates.length / 10)),
          },
          axisLine: { lineStyle: { color: "#30363d" } },
        },
        yAxis: {
          type: "value",
          scale: true,
          min: hasY ? yMin : undefined,
          max: hasY ? yMax : undefined,
          name: "价格",
          nameTextStyle: { color: "#8b949e" },
          axisLabel: { color: "#8b949e" },
          splitLine: { lineStyle: { color: "#21262d" } },
        },
        series,
      },
      true
    );
    chart.current.resize();
  }, [payload, frameIdx, activeSyms, allSyms]);

  const togglePlay = () => {
    if (!payload) return;
    if (playing) {
      setPlaying(false);
      setStopped(true);
      return;
    }
    if (atEnd) setFrameIdx(0);
    setStopped(false);
    setPlaying(true);
  };

  const updateCue = (id: string, patch: Partial<SubtitleCue>) => {
    setCues((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const updateLeg = (id: string, patch: Partial<AssetLeg>) => {
    setActivePreset(null);
    setLegs((list) => list.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const needsJson = legs.some((l) => l.source === "custom-json");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, gap: 8 }}>
      {toast ? (
        <div
          role="status"
          style={{
            ...toastStyle,
            background: toast.kind === "ok" ? "rgba(63,185,80,0.16)" : "rgba(255,123,114,0.16)",
            borderColor: toast.kind === "ok" ? "#3fb950" : "#ff7b72",
            color: toast.kind === "ok" ? "#3fb950" : "#ff7b72",
          }}
        >
          {toast.text}
          <button
            type="button"
            style={toastClose}
            onClick={() => setToast(null)}
            aria-label="关闭提示"
          >
            ×
          </button>
        </div>
      ) : null}

      {/* 多来源资产腿 */}
      <div style={legBox}>
        <div style={{ ...controlsStyle, marginBottom: 6 }}>
          <strong style={{ fontSize: 13 }}>组合资产（多来源）</strong>
          <label style={labelStyle}>
            起始
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setActivePreset(null);
                setStartDate(e.target.value);
              }}
              style={{ ...inputStyle, width: 148, marginLeft: 6 }}
            />
          </label>
          <label style={labelStyle}>
            终止
            <input
              type="date"
              value={endDate}
              max={todayYmd()}
              onChange={(e) => {
                setActivePreset(null);
                setEndDate(e.target.value || todayYmd());
              }}
              style={{ ...inputStyle, width: 148, marginLeft: 6 }}
            />
          </label>
          <button
            type="button"
            style={btnGhost}
            onClick={() => {
              setActivePreset(null);
              setLegs((list) => [
                ...list,
                newAssetLeg({ source: "gate", symbol: "ETH", label: "ETH" }),
              ]);
            }}
          >
            + 资产
          </button>
          {ASSET_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              style={activePreset === preset.id ? btnPresetActive : btnGhost}
              title="先点选组合，再点「加载组合」拉数"
              onClick={() => applyPreset(preset.id)}
            >
              {preset.name}
            </button>
          ))}
          {needsJson || showJson ? (
            <button type="button" style={btnGhost} onClick={() => setShowJson((v) => !v)}>
              {showJson ? "收起 JSON" : "自定义 JSON"}
            </button>
          ) : (
            <button type="button" style={btnGhost} onClick={() => setShowJson(true)}>
              自定义 JSON
            </button>
          )}
          <button type="button" style={btnStyle} disabled={loading} onClick={() => void load()}>
            {loading ? "加载中…" : "加载组合"}
          </button>
          <button
            type="button"
            style={btnGhost}
            disabled={loading}
            title="忽略缓存，按当前日期重新请求"
            onClick={() => void load({ force: true })}
          >
            强制刷新
          </button>
          <span style={{ color: "#8b949e", fontSize: 12 }}>
            {payload
              ? `${payload.meta.label} · ${payload.dates.length} 天`
              : "先点选快捷组合，再点「加载组合」获取数据"}
            {cacheHint ? ` · ${cacheHint}` : ""}
            {cachedRanges.length
              ? ` · 缓存(${cachedRanges.length}/${PRICE_CACHE_MAX}): ${cachedRanges
                  .map((c) => `${c.startDate}~${c.endDate}`)
                  .join(" | ")}`
              : ""}
          </span>
        </div>

        {legs.map((leg) => (
          <div key={leg.id} style={legRow}>
            <select
              value={leg.source}
              onChange={(e) => {
                const source = e.target.value as AssetSourceKind;
                const patch: Partial<AssetLeg> = { source };
                if (source === "sina" && (leg.symbol === "BTC" || leg.symbol === "BANK5Y" || !leg.symbol)) {
                  patch.symbol = ".IXIC";
                  patch.label = /BTC|定存/.test(leg.label) ? "纳斯达克" : leg.label;
                }
                if (
                  (source === "binance" || source === "gate") &&
                  (leg.symbol.startsWith(".") || leg.symbol.startsWith("sh") || leg.symbol === "BANK5Y")
                ) {
                  patch.symbol = "BTC";
                  patch.label = /纳斯|沪深|定存/.test(leg.label) ? "BTC" : leg.label;
                }
                if (source === "bank-deposit") {
                  patch.symbol = "BANK5Y";
                  patch.label = "银行5年期整存整取";
                }
                updateLeg(leg.id, patch);
              }}
              style={{ ...inputStyle, width: 148 }}
            >
              <option value="gate">Gate 币（更早）</option>
              <option value="binance">Binance 币（约2017起）</option>
              <option value="sina">新浪 指数/股</option>
              <option value="bank-deposit">银行5年期整存整取</option>
              <option value="custom-json">自定义 JSON</option>
              <option value="custom-url">自定义 URL</option>
            </select>
            <input
              value={leg.symbol}
              onChange={(e) => updateLeg(leg.id, { symbol: e.target.value })}
              placeholder={
                leg.source === "sina"
                  ? ".IXIC / sh000300"
                  : leg.source === "bank-deposit"
                    ? "BANK5Y"
                    : "BTC"
              }
              style={{ ...inputStyle, width: 140 }}
              disabled={leg.source === "custom-json" || leg.source === "bank-deposit"}
            />
            <input
              value={leg.label}
              onChange={(e) => updateLeg(leg.id, { label: e.target.value })}
              placeholder="显示名"
              style={{ ...inputStyle, width: 140 }}
            />
            {leg.source === "custom-url" ? (
              <input
                value={leg.url ?? ""}
                onChange={(e) => updateLeg(leg.id, { url: e.target.value })}
                placeholder="数据 URL"
                style={{ ...inputStyle, flex: 1, minWidth: 160 }}
              />
            ) : null}
            {leg.source === "custom-json" ? (
              <input
                value={leg.jsonKey ?? ""}
                onChange={(e) => updateLeg(leg.id, { jsonKey: e.target.value })}
                placeholder="JSON 内 key（默认同显示名）"
                style={{ ...inputStyle, width: 180 }}
              />
            ) : null}
            <button
              type="button"
              style={btnGhost}
              disabled={legs.length <= 1}
              onClick={() => {
                setActivePreset(null);
                setLegs((list) => list.filter((x) => x.id !== leg.id));
              }}
            >
              删
            </button>
          </div>
        ))}

        {showJson || needsJson ? (
          <textarea
            value={customJsonText}
            onChange={(e) => setCustomJsonText(e.target.value)}
            rows={3}
            spellCheck={false}
            style={{
              ...inputStyle,
              width: "100%",
              marginTop: 6,
              fontFamily: "ui-monospace, monospace",
              fontSize: 12,
              resize: "vertical",
            }}
          />
        ) : null}
      </div>

      <div style={controlsStyle}>
        <button type="button" style={btnStyle} disabled={!payload} onClick={togglePlay}>
          {playing ? "暂停" : atEnd || stopped ? "重播" : "播放"}
        </button>
        <button
          type="button"
          style={btnGhost}
          disabled={!payload}
          onClick={() => {
            setPlaying(false);
            setStopped(true);
            setFrameIdx(0);
          }}
        >
          复位
        </button>
        <label style={labelStyle}>
          速度
          <input
            type="range"
            min={0}
            max={160}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            style={{ width: 140, marginLeft: 6 }}
          />
          <span style={{ marginLeft: 4 }}>{speed}</span>
        </label>
        <label style={labelStyle}>
          起始金额
          <input
            type="number"
            min={1}
            step={10000}
            value={initialCapital}
            onChange={(e) => setInitialCapital(Math.max(1, Number(e.target.value) || 1))}
            style={{ ...inputStyle, width: 120, marginLeft: 6 }}
          />
        </label>
        <label style={labelStyle}>
          图高
          <input
            type="range"
            min={240}
            max={900}
            step={10}
            value={chartHeight}
            onChange={(e) => setChartHeight(Number(e.target.value))}
            style={{ width: 120, marginLeft: 6 }}
          />
          <span style={{ marginLeft: 4 }}>{chartHeight}px</span>
        </label>
        <button
          type="button"
          style={subtitleEdit ? btnStyle : btnGhost}
          onClick={() => {
            setSubtitleEdit((v) => !v);
            setSelectedCueId(null);
          }}
        >
          {subtitleEdit ? "字幕编辑中" : "编辑字幕"}
        </button>
        <button
          type="button"
          style={btnGhost}
          onClick={() => {
            const cue = newSubtitleCue({
              text: "{date}\n{pnlLines}",
              x: 50,
              y: 70,
              showOnStop: false,
              startDate: "",
              endDate: "",
            });
            setCues((list) => [...list, cue]);
            setSubtitleEdit(true);
            setSelectedCueId(cue.id);
          }}
        >
          + 字幕
        </button>
        <span style={{ color: "#c9d1d9", fontSize: 13, fontWeight: 600 }}>
          {currentDate || "—"}
          {payload ? `  ·  ${frameIdx + 1}/${payload.dates.length}` : ""}
        </span>
      </div>

      {allSyms.length ? (
        <div style={{ ...controlsStyle, marginBottom: 0 }}>
          <span style={{ color: "#8b949e", fontSize: 12 }}>播放显示</span>
          {allSyms.map((sym, idx) => (
            <label key={sym} style={labelStyle}>
              <input
                type="checkbox"
                checked={enabled[sym] !== false}
                onChange={(e) =>
                  setEnabled((prev) => ({ ...prev, [sym]: e.target.checked }))
                }
              />
              <span style={{ color: COLORS[idx % COLORS.length], fontWeight: 700 }}>{sym}</span>
            </label>
          ))}
        </div>
      ) : null}

      {pnlRows.length ? (
        <div style={pnlStrip}>
          {pnlRows.map((r) => (
            <div key={r.sym} style={pnlCard}>
              <div style={{ color: r.color, fontWeight: 800, fontSize: 13 }}>{r.sym}</div>
              <div style={{ fontSize: 12, color: "#8b949e" }}>
                价{" "}
                <span style={{ color: "#e6edf3" }}>
                  {r.price == null
                    ? "-"
                    : Number(r.price).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                </span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>
                {r.value == null ? "-" : formatMoney(r.value)}
                {atEnd && r.value != null ? (
                  <span style={{ marginLeft: 6, fontSize: 11, color: "#8b949e" }}>终点市值</span>
                ) : null}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: (r.pnl ?? 0) >= 0 ? "#3fb950" : "#ff7b72",
                }}
              >
                {r.pnl == null
                  ? "-"
                  : `${r.pnl >= 0 ? "+" : ""}${formatMoney(r.pnl)} (${
                      r.pnlPct == null
                        ? "-"
                        : `${r.pnlPct >= 0 ? "+" : ""}${r.pnlPct.toFixed(1)}%`
                    })`}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {error ? <div style={{ color: "#ff7b72", fontSize: 13 }}>{error}</div> : null}

      {/* 与上方设置拉开距离，录制时只框 chart 区不易露控件 */}
      <div style={chartZone}>
        <div
          ref={stageRef}
          style={{
            ...stageStyle,
            height: chartHeight,
            flex: "none",
          }}
          onClick={() => {
            if (subtitleEdit) setSelectedCueId(null);
          }}
        >
          <div ref={chartRef} style={chartStyle} />
          {stageCues.map((c) => (
            <FloatingSubtitle
              key={c.id}
              cue={c}
              displayText={interpolateSubtitle(c.text, interpCtx)}
              stageRef={stageRef}
              editing={subtitleEdit}
              selected={selectedCueId === c.id}
              assetLabels={activeSyms}
              onSelect={() => setSelectedCueId(c.id)}
              onChange={(patch) => updateCue(c.id, patch)}
              onRemove={() => {
                setCues((list) => list.filter((x) => x.id !== c.id));
                setSelectedCueId(null);
              }}
            />
          ))}
          <div
            role="separator"
            aria-label="拖拽调整图表高度"
            title="拖拽调整高度"
            onPointerDown={onHeightDragStart}
            style={resizeHandle}
          />
        </div>
      </div>
    </div>
  );
};

const controlsStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 10,
  alignItems: "center",
  flexShrink: 0,
};
const inputStyle: React.CSSProperties = {
  background: "#0d1117",
  border: "1px solid #30363d",
  color: "#e6edf3",
  borderRadius: 8,
  padding: "7px 10px",
};
const labelStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
  alignItems: "center",
  color: "#8b949e",
  fontSize: 12,
};
const btnStyle: React.CSSProperties = {
  background: "#f0883e",
  border: "none",
  color: "#0d1117",
  fontWeight: 700,
  borderRadius: 8,
  padding: "8px 14px",
  cursor: "pointer",
};
const btnGhost: React.CSSProperties = {
  background: "#21262d",
  border: "1px solid #30363d",
  color: "#e6edf3",
  borderRadius: 8,
  padding: "7px 12px",
  cursor: "pointer",
  fontSize: 12,
};
const btnPresetActive: React.CSSProperties = {
  ...btnGhost,
  background: "rgba(240,136,62,0.18)",
  border: "1px solid #f0883e",
  color: "#f0883e",
  fontWeight: 700,
};
const toastStyle: React.CSSProperties = {
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid",
  fontSize: 13,
  fontWeight: 600,
};
const toastClose: React.CSSProperties = {
  marginLeft: "auto",
  background: "transparent",
  border: "none",
  color: "inherit",
  fontSize: 18,
  lineHeight: 1,
  cursor: "pointer",
  padding: "0 4px",
};
const legBox: React.CSSProperties = {
  border: "1px solid #30363d",
  borderRadius: 12,
  padding: 10,
  background: "rgba(13,17,23,0.65)",
  flexShrink: 0,
};
const legRow: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  alignItems: "center",
  marginBottom: 6,
};
const pnlStrip: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  flexShrink: 0,
};
const pnlCard: React.CSSProperties = {
  minWidth: 140,
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #30363d",
  background: "#0d1117",
};
const chartZone: React.CSSProperties = {
  marginTop: 96,
  paddingTop: 48,
  paddingBottom: 24,
  borderTop: "1px solid #21262d",
  background: "#0d1117",
  flexShrink: 0,
};
const stageStyle: React.CSSProperties = {
  position: "relative",
  borderRadius: 12,
  overflow: "visible",
  border: "1px solid #30363d",
  background: "#0d1117",
  flexShrink: 0,
  isolation: "isolate",
};
const chartStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
};
const resizeHandle: React.CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: -5,
  height: 10,
  cursor: "ns-resize",
  zIndex: 5,
  background:
    "linear-gradient(to bottom, transparent 0%, transparent 35%, #30363d 35%, #30363d 65%, transparent 65%)",
};
