import React, { useMemo } from "react";
import { formatMoney } from "../../lib/priceSource";

export type RankRow = {
  sym: string;
  color: string;
  pnl: number | null;
  pnlPct: number | null;
};

type Props = {
  rows: RankRow[];
  date: string;
  /** 起始金额，用于空态提示 */
  initialCapital: number;
  /** 当日涨幅榜前三 symbol（与图表 mark 一致） */
  dailyTop3?: string[];
};

/** 按收益率排序：大的在上，小的在下；带盈亏金额与柱条 */
export const BarRaceRankList: React.FC<Props> = ({
  rows,
  date,
  initialCapital,
  dailyTop3 = [],
}) => {
  const sorted = useMemo(() => {
    return [...rows]
      .filter((r) => r.pnlPct != null || r.pnl != null)
      .sort((a, b) => {
        const pa = a.pnlPct ?? (a.pnl != null ? a.pnl / initialCapital : 0) * 100;
        const pb = b.pnlPct ?? (b.pnl != null ? b.pnl / initialCapital : 0) * 100;
        return pb - pa;
      });
  }, [rows, initialCapital]);

  const maxAbsPct = useMemo(() => {
    let m = 0;
    for (const r of sorted) {
      const p = Math.abs(r.pnlPct ?? 0);
      if (p > m) m = p;
    }
    return m || 1;
  }, [sorted]);

  if (!sorted.length) {
    return (
      <div style={panelStyle}>
        <div style={headerStyle}>
          <span style={{ fontWeight: 800, fontSize: 14 }}>涨跌榜</span>
        </div>
        <div style={{ padding: 16, color: "#8b949e", fontSize: 12, lineHeight: 1.6 }}>
          加载组合并开始播放后，此处按收益率从高到低排列。
        </div>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <span style={{ fontWeight: 800, fontSize: 14 }}>涨跌榜</span>
        <span style={{ color: "#8b949e", fontSize: 11 }}>{date || "—"}</span>
      </div>
      <div style={listStyle}>
        {sorted.map((r, i) => {
          const pct = r.pnlPct ?? 0;
          const up = pct >= 0;
          const barW = Math.max(4, (Math.abs(pct) / maxAbsPct) * 100);
          const leaderRank = dailyTop3.indexOf(r.sym);
          const isDailyLeader = leaderRank >= 0;
          const pnlText =
            r.pnl == null
              ? "-"
              : `${r.pnl >= 0 ? "+" : ""}${formatMoney(r.pnl)}`;
          const pctText =
            r.pnlPct == null ? "-" : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;

          return (
            <div key={r.sym} style={rowStyle}>
              <div style={rowTop}>
                <span style={{ color: "#484f58", fontSize: 11, width: 18, flexShrink: 0 }}>
                  {i + 1}
                </span>
                <span
                  style={{
                    color: r.color,
                    fontWeight: 700,
                    fontSize: 12,
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={r.sym}
                >
                  {r.sym}
                </span>
                {isDailyLeader ? (
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 800,
                      color: "#0d1117",
                      background:
                        leaderRank === 0
                          ? "#fbbf24"
                          : leaderRank === 1
                            ? "#cbd5e1"
                            : "#cd7f32",
                      padding: "1px 5px",
                      borderRadius: 4,
                      flexShrink: 0,
                    }}
                    title={`当日涨幅榜第 ${leaderRank + 1} 名`}
                  >
                    榜{leaderRank + 1}
                  </span>
                ) : null}
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: up ? "#3fb950" : "#ff7b72",
                    textAlign: "right",
                    flexShrink: 0,
                  }}
                >
                  {pnlText}
                </span>
              </div>
              <div style={rowMid}>
                <span style={{ fontSize: 11, color: up ? "#3fb950" : "#ff7b72", fontWeight: 600 }}>
                  {pctText}
                </span>
              </div>
              <div style={barTrack}>
                <div
                  style={{
                    height: "100%",
                    width: `${barW}%`,
                    borderRadius: 3,
                    background: up
                      ? "linear-gradient(90deg, rgba(63,185,80,0.35), #3fb950)"
                      : "linear-gradient(90deg, rgba(255,123,114,0.35), #ff7b72)",
                    transition: "width 0.15s ease-out",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const panelStyle: React.CSSProperties = {
  width: 280,
  height: "100%",
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  border: "1px solid #30363d",
  borderRadius: 12,
  background: "#0d1117",
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 12px",
  borderBottom: "1px solid #21262d",
  flexShrink: 0,
};

const listStyle: React.CSSProperties = {
  flex: 1,
  overflow: "auto",
  padding: "8px 10px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const rowTop: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
};

const rowMid: React.CSSProperties = {
  paddingLeft: 24,
};

const barTrack: React.CSSProperties = {
  marginLeft: 24,
  height: 6,
  borderRadius: 3,
  background: "#21262d",
  overflow: "hidden",
};
