import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TemplateEditor } from "./editor/TemplateEditor";
import { exportCardPng } from "./exportPng";
import { formatPnl } from "./calc";
import { computePnl } from "./formatField";
import { useAutoSave } from "./hooks/useAutoSave";
import { CardPreview } from "./preview/CardPreview";
import { loadPrefs, loadTradeDraft, savePrefs, saveTradeDraft } from "./storage/draft";
import {
  loadTemplateFromStorage,
  resolveTemplate,
  saveTemplateToStorage,
} from "./storage/templates";
import { EXCHANGES } from "./types";
import type { CardTemplate, Exchange, TradeInput } from "./types";

type Mode = "export" | "editor";

const EMPTY_TRADE: TradeInput = {
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

export const PnlCardsApp: React.FC = () => {
  const [mode, setMode] = useState<Mode>(() => loadPrefs()?.mode ?? "export");
  const [exchange, setExchange] = useState<Exchange>(() => loadPrefs()?.exchange ?? "okx");
  const [template, setTemplate] = useState<CardTemplate | null>(null);
  const [trade, setTrade] = useState<TradeInput>({ ...EMPTY_TRADE });
  const [exporting, setExporting] = useState(false);
  const [err, setErr] = useState("");
  const editorTemplateRef = useRef<CardTemplate | null>(null);

  useEffect(() => {
    savePrefs({ mode, exchange });
  }, [mode, exchange]);

  useEffect(() => {
    const draft = loadTradeDraft(exchange);
    setTrade(draft ? { ...EMPTY_TRADE, ...draft } : { ...EMPTY_TRADE });
  }, [exchange]);

  const persistTrade = useCallback(
    (t: TradeInput) => saveTradeDraft(exchange, t),
    [exchange]
  );
  useAutoSave(trade, persistTrade, exchange);

  const applyExportTemplate = useCallback((ex: Exchange) => {
    const cached = loadTemplateFromStorage(ex);
    if (cached) {
      setTemplate(cached);
      return;
    }
    setTemplate(null);
    setErr("");
    void resolveTemplate(ex)
      .then(setTemplate)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    if (mode !== "export") return;
    applyExportTemplate(exchange);
  }, [exchange, mode, applyExportTemplate]);

  const switchToExport = () => {
    const latest =
      editorTemplateRef.current ?? loadTemplateFromStorage(exchange);
    if (latest) {
      saveTemplateToStorage(latest);
      setTemplate(latest);
    }
    setMode("export");
  };

  const pnlPct = useMemo(() => computePnl(trade), [trade]);

  const patchTrade = (patch: Partial<TradeInput>) => {
    setTrade((t) => ({ ...t, ...patch }));
  };

  const onExport = async () => {
    const node = document.getElementById("card");
    if (!node) return;
    setExporting(true);
    try {
      const sym = trade.symbol.trim() || "pnl";
      await exportCardPng(node, `${sym}-${exchange}-${Date.now()}.png`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={shell}>
      <header style={header}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, color: "#e6edf3" }}>盈利图生成</h1>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#8b949e" }}>
            本地叠字出图 · 非官方凭证 · 不含 API / 下单
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            style={mode === "export" ? tabActive : tab}
            onClick={switchToExport}
          >
            出图
          </button>
          <button
            type="button"
            style={mode === "editor" ? tabActive : tab}
            onClick={() => setMode("editor")}
          >
            模板编辑
          </button>
        </div>
      </header>

      {err ? <div style={errorBox}>{err}</div> : null}

      {mode === "editor" ? (
        <TemplateEditor
          exchange={exchange}
          onExchangeChange={setExchange}
          onTemplateChange={(t) => {
            editorTemplateRef.current = t;
          }}
        />
      ) : (
        <div style={exportLayout}>
          <aside style={formPane}>
            <label style={label}>
              交易所模板
              <select
                value={exchange}
                onChange={(e) => setExchange(e.target.value as Exchange)}
                style={input}
              >
                {EXCHANGES.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>

            <label style={label}>
              品种
              <input
                value={trade.symbol}
                onChange={(e) => patchTrade({ symbol: e.target.value })}
                placeholder="BTCUSDT"
                style={input}
              />
            </label>

            <label style={label}>
              市场
              <select
                value={trade.market}
                onChange={(e) =>
                  patchTrade({ market: e.target.value as TradeInput["market"] })
                }
                style={input}
              >
                <option value="swap">永续</option>
                <option value="spot">现货</option>
              </select>
            </label>

            <label style={label}>
              方向
              <select
                value={trade.side}
                onChange={(e) => patchTrade({ side: e.target.value as TradeInput["side"] })}
                style={input}
              >
                <option value="long">做多</option>
                <option value="short">做空</option>
              </select>
            </label>

            <label style={label}>
              杠杆
              <input
                type="number"
                min={0}
                value={trade.leverage || ""}
                onChange={(e) => patchTrade({ leverage: Number(e.target.value) || 0 })}
                placeholder="20"
                style={input}
              />
            </label>

            <label style={label}>
              状态
              <select
                value={trade.status}
                onChange={(e) =>
                  patchTrade({ status: e.target.value as TradeInput["status"] })
                }
                style={input}
              >
                <option value="closed">已平仓</option>
                <option value="open">持仓中</option>
              </select>
            </label>

            <label style={label}>
              开仓价
              <input
                type="number"
                step="any"
                value={trade.entry || ""}
                onChange={(e) => patchTrade({ entry: Number(e.target.value) || 0 })}
                style={input}
              />
            </label>

            <label style={label}>
              {trade.status === "open" ? "标记价" : "平仓均价"}
              <input
                type="number"
                step="any"
                value={trade.exit || ""}
                onChange={(e) => patchTrade({ exit: Number(e.target.value) || 0 })}
                style={input}
              />
            </label>

            <div style={calcBox}>
              收益率（自动）
              <strong style={{ color: pnlPct >= 0 ? "#00C853" : "#FF4D4F", fontSize: 18 }}>
                {trade.entry > 0 && trade.exit > 0 ? formatPnl(pnlPct) : "—"}
              </strong>
            </div>

            <label style={label}>
              时间
              <input
                value={trade.time ?? ""}
                onChange={(e) => patchTrade({ time: e.target.value })}
                placeholder="2026-09-23 14:30"
                style={input}
              />
            </label>

            <label style={label}>
              昵称
              <input
                value={trade.nickname ?? ""}
                onChange={(e) => patchTrade({ nickname: e.target.value })}
                style={input}
              />
            </label>

            <label style={label}>
              邀请码
              <input
                value={trade.inviteCode ?? ""}
                onChange={(e) => patchTrade({ inviteCode: e.target.value })}
                style={input}
              />
            </label>

            <label style={label}>
              头像 PNG
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                style={input}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) {
                    patchTrade({ avatarUrl: "" });
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () =>
                    patchTrade({ avatarUrl: String(reader.result ?? "") });
                  reader.readAsDataURL(file);
                }}
              />
            </label>

            <button
              type="button"
              style={btnPrimary}
              disabled={!template || exporting}
              onClick={() => void onExport()}
            >
              {exporting ? "导出中…" : "导出 PNG"}
            </button>
          </aside>

          <div style={previewPane}>
            {!template ? (
              <div style={{ color: "#8b949e" }}>加载模板…</div>
            ) : (
              <CardPreview template={template} trade={trade} cardId="card" />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const shell: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
  padding: 16,
  gap: 12,
  background: "#0d1117",
  color: "#e6edf3",
  fontFamily: '"IBM Plex Sans", "PingFang SC", sans-serif',
  overflow: "hidden",
};

const header: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  flexShrink: 0,
};

const tab: React.CSSProperties = {
  background: "#21262d",
  border: "1px solid #30363d",
  color: "#e6edf3",
  borderRadius: 8,
  padding: "8px 14px",
  cursor: "pointer",
  fontSize: 13,
};

const tabActive: React.CSSProperties = {
  ...tab,
  background: "rgba(240,136,62,0.18)",
  borderColor: "#f0883e",
  color: "#f0883e",
  fontWeight: 700,
};

const exportLayout: React.CSSProperties = {
  display: "flex",
  gap: 16,
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
};

const formPane: React.CSSProperties = {
  width: 280,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  overflow: "auto",
  padding: 12,
  background: "#161b22",
  borderRadius: 12,
  border: "1px solid #30363d",
};

const previewPane: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "auto",
  padding: 16,
  background: "#161b22",
  borderRadius: 12,
  border: "1px solid #30363d",
  display: "flex",
  justifyContent: "center",
  alignItems: "flex-start",
};

const label: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 11,
  color: "#8b949e",
};

const input: React.CSSProperties = {
  background: "#0d1117",
  border: "1px solid #30363d",
  color: "#e6edf3",
  borderRadius: 8,
  padding: "7px 10px",
  fontSize: 13,
};

const btnPrimary: React.CSSProperties = {
  background: "#f0883e",
  border: "none",
  color: "#0d1117",
  fontWeight: 700,
  borderRadius: 8,
  padding: "10px 14px",
  cursor: "pointer",
  marginTop: 4,
};

const calcBox: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: 10,
  borderRadius: 8,
  background: "#0d1117",
  border: "1px solid #30363d",
  fontSize: 11,
  color: "#8b949e",
};

const errorBox: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  background: "rgba(255,77,79,0.12)",
  border: "1px solid #FF4D4F",
  color: "#ff7b72",
  fontSize: 12,
};
