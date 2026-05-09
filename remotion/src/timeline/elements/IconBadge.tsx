import React from "react";
import { AbsoluteFill } from "remotion";
import type { IconBadgeLayer } from "../../lib/types";
import { resolveSemanticPosition } from "../../lib/layout";

type Props = { layer: IconBadgeLayer };

function TrendUpSvg({ color }: { color: string }) {
  return (
    <svg width="100%" height="100%" viewBox="0 0 64 64" aria-hidden>
      <path
        d="M8 48 L24 32 L36 40 L56 16"
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M44 16 H56 V28" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

function TrendDownSvg({ color }: { color: string }) {
  return (
    <svg width="100%" height="100%" viewBox="0 0 64 64" aria-hidden>
      <path
        d="M8 16 L24 32 L36 22 L56 46"
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M44 46 H56 V34" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

function KlineSvg({ up }: { up: boolean }) {
  const green = "#34d399";
  const red = "#fb7185";
  const bull = up;
  return (
    <svg width="100%" height="100%" viewBox="0 0 80 56" aria-hidden>
      {[12, 28, 44, 60].map((cx, i) => {
        const h = bull ? 10 + i * 6 : 28 - i * 4;
        const y = bull ? 40 - h : 16;
        const wickTop = bull ? y - 6 : y + h + 2;
        const wickBot = bull ? y + h + 6 : y - 4;
        const fill = i % 2 === 0 ? (bull ? green : red) : bull ? red : green;
        return (
          <g key={cx}>
            <line x1={cx} x2={cx} y1={wickTop} y2={wickBot} stroke={fill} strokeWidth="2" />
            <rect x={cx - 5} y={y} width={10} height={h} rx={2} fill={fill} opacity={0.92} />
          </g>
        );
      })}
    </svg>
  );
}

export const IconBadge: React.FC<Props> = ({ layer }) => {
  const { icon, label, size = 120, position, style } = layer.props;
  const pos = resolveSemanticPosition(typeof position === "string" ? position : undefined);
  const upColor = "#4ade80";
  const downColor = "#f87171";

  const custom: React.CSSProperties = {};
  if (style && typeof style === "object") {
    for (const [k, v] of Object.entries(style)) {
      (custom as Record<string, string | number>)[k] = v;
    }
  }

  let glyph: React.ReactNode;
  const ic = String(icon).toLowerCase();
  if (ic === "trend_up" || ic === "line_up" || ic === "bar_up") {
    glyph = <TrendUpSvg color={upColor} />;
  } else if (ic === "trend_down" || ic === "line_down" || ic === "bar_down") {
    glyph = <TrendDownSvg color={downColor} />;
  } else if (ic === "kline_up" || ic === "candlestick_up") {
    glyph = <KlineSvg up />;
  } else if (ic === "kline_down" || ic === "candlestick_down") {
    glyph = <KlineSvg up={false} />;
  } else {
    glyph = (
      <div style={{ color: "#94a3b8", fontSize: 28, fontWeight: 700, textAlign: "center" }}>
        {icon}
      </div>
    );
  }

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          ...pos,
          width: size,
          height: size,
          borderRadius: 22,
          background: "rgba(15, 23, 42, 0.78)",
          border: "1px solid rgba(148, 163, 184, 0.35)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          ...custom,
        }}
      >
        <div style={{ width: "72%", height: "62%" }}>{glyph}</div>
        {label ? (
          <div style={{ color: "#e2e8f0", fontSize: 18, fontWeight: 600, textAlign: "center" }}>
            {label}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
