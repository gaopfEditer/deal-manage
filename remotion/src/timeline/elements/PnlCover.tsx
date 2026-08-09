import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { PnlCoverLayer } from "../../lib/types";

type Props = {
  layer: PnlCoverLayer;
  durationInFrames: number;
};

const FONT =
  '"Avenir Next", "DIN Alternate", "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", sans-serif';

function fmtMoney(n: number): string {
  return `$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function fmtPrice(n: number): string {
  const digits = Math.abs(n) >= 1 ? 2 : 6;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: Math.min(2, digits),
    maximumFractionDigits: digits,
  });
}

export const PnlCover: React.FC<Props> = ({ layer, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const {
    symbol = "ETH",
    title = "发车复盘",
    subtitle,
    side = "long",
    returnPercent = 0,
    profit = 0,
    entryValue = 0,
    tag,
    entryTime,
    entryPrice,
    exitPrice,
    leverage = 20,
  } = layer.props;

  const positive = returnPercent >= 0;
  const accent = positive ? "#2dd4a8" : "#f07178";
  const accentDim = positive ? "rgba(45,212,168,0.18)" : "rgba(240,113,120,0.18)";
  const sideLabel = tag || (side === "long" ? "多单" : "空单");

  const enterTitle = spring({
    frame: Math.max(0, frame - 10),
    fps,
    config: { damping: 18, stiffness: 100 },
  });
  const enterMetrics = spring({
    frame: Math.max(0, frame - 20),
    fps,
    config: { damping: 20, stiffness: 75 },
  });

  const fadeOut = interpolate(
    frame,
    [Math.max(0, durationInFrames - 12), Math.max(1, durationInFrames - 1)],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const heroBreath = interpolate(
    Math.sin((frame / fps) * Math.PI * 1.1),
    [-1, 1],
    [0.985, 1.02]
  );
  const heroGlow = interpolate(
    Math.sin((frame / fps) * Math.PI * 1.35),
    [-1, 1],
    [0.4, 0.85]
  );
  const ringScale = interpolate(frame, [0, durationInFrames], [0.72, 1.18], {
    extrapolateRight: "clamp",
  });
  const ringOpacity = interpolate(
    frame,
    [0, 10, durationInFrames * 0.7, durationInFrames],
    [0.35, 0.5, 0.22, 0.08],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const scanY = interpolate(frame, [0, durationInFrames], [18, 72], {
    extrapolateRight: "clamp",
  });

  const titleY = interpolate(enterTitle, [0, 1], [28, 0]);
  const metricsY = interpolate(enterMetrics, [0, 1], [32, 0]);

  const pctText = `${positive ? "+" : ""}${returnPercent.toFixed(2)}%`;
  const profitText = `${profit >= 0 ? "+" : "-"}${fmtMoney(profit)}`;

  const heroFacts = [
    { label: "币种", value: symbol },
    { label: "杠杆", value: `${leverage}x` },
    ...(entryTime ? [{ label: "发车时间", value: entryTime }] : []),
    ...(entryPrice != null && Number.isFinite(entryPrice)
      ? [{ label: "起始价", value: fmtPrice(entryPrice) }]
      : []),
    ...(exitPrice != null && Number.isFinite(exitPrice)
      ? [{ label: "结束价", value: fmtPrice(exitPrice) }]
      : []),
  ];

  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        opacity: fadeOut,
        fontFamily: FONT,
        background:
          "radial-gradient(120% 80% at 50% 18%, #132033 0%, #0a1018 42%, #06090e 100%)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(120,180,210,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(120,180,210,0.045) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse at 50% 40%, black 20%, transparent 75%)",
          opacity: interpolate(frame, [0, 20], [0.35, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "40%",
          width: 780,
          height: 780,
          transform: `translate(-50%, -50%) scale(${ringScale})`,
          borderRadius: "50%",
          border: `1px solid ${accent}44`,
          opacity: ringOpacity,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "40%",
          width: 640,
          height: 640,
          transform: "translate(-50%, -50%)",
          borderRadius: "50%",
          background: `radial-gradient(circle, ${accentDim} 0%, transparent 62%)`,
          opacity: heroGlow,
          filter: "blur(8px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "8%",
          right: "8%",
          top: `${scanY}%`,
          height: 1,
          background: `linear-gradient(90deg, transparent, ${accent}88, transparent)`,
          opacity: 0.35,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: 3,
          background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
          opacity: 0.55,
        }}
      />

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 48px",
        }}
      >
        {/* 第一帧即可见：收益率 + 币种 / 发车时间 / 价位 */}
        <div
          style={{
            textAlign: "center",
            transform: `scale(${heroBreath})`,
            width: "100%",
          }}
        >
          <div
            style={{
              fontSize: 22,
              color: "#7d8fa3",
              letterSpacing: 8,
              marginBottom: 10,
              fontWeight: 600,
            }}
          >
            收益率 · {leverage}x
          </div>
          <div
            style={{
              fontSize: 120,
              fontWeight: 800,
              color: accent,
              letterSpacing: -2,
              lineHeight: 1,
              textShadow: `0 0 ${40 + heroGlow * 40}px ${accent}66, 0 12px 40px rgba(0,0,0,0.45)`,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {pctText}
          </div>

          <div
            style={{
              marginTop: 36,
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              rowGap: 18,
              width: "100%",
              maxWidth: 960,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            {heroFacts.map((item) => (
              <div
                key={item.label}
                style={{
                  minWidth: "28%",
                  flex: "1 1 28%",
                  padding: "0 12px",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: 16,
                    color: "#7d8fa3",
                    letterSpacing: 3,
                    marginBottom: 8,
                  }}
                >
                  {item.label}
                </div>
                <div
                  style={{
                    fontSize: 26,
                    fontWeight: 700,
                    color: "#e8eef5",
                    fontVariantNumeric: "tabular-nums",
                    letterSpacing: 0.5,
                  }}
                >
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            marginTop: 44,
            opacity: enterTitle,
            transform: `translateY(${titleY}px)`,
            textAlign: "center",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 14,
            }}
          >
            <span
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: accent,
                padding: "6px 14px",
                borderRadius: 999,
                border: `1px solid ${accent}66`,
                background: accentDim,
                letterSpacing: 2,
              }}
            >
              {sideLabel}
            </span>
          </div>
          <div
            style={{
              fontSize: 44,
              fontWeight: 700,
              color: "#e8eef5",
              letterSpacing: 2,
              lineHeight: 1.15,
            }}
          >
            {title}
          </div>
          {subtitle ? (
            <div
              style={{
                marginTop: 12,
                fontSize: 22,
                color: "#7d8fa3",
                letterSpacing: 1,
              }}
            >
              {subtitle}
            </div>
          ) : null}
        </div>

        <div
          style={{
            marginTop: 48,
            width: "100%",
            maxWidth: 820,
            display: "flex",
            justifyContent: "space-between",
            gap: 28,
            opacity: enterMetrics,
            transform: `translateY(${metricsY}px)`,
          }}
        >
          {[
            { label: "开仓价值", value: fmtMoney(entryValue), color: "#d7e0ea" },
            { label: "收获", value: profitText, color: accent },
          ].map((item, i) => (
            <div
              key={item.label}
              style={{
                flex: 1,
                textAlign: i === 0 ? "left" : "right",
                paddingTop: 18,
                borderTop: "1px solid rgba(140,170,200,0.22)",
              }}
            >
              <div
                style={{
                  fontSize: 20,
                  color: "#7d8fa3",
                  letterSpacing: 4,
                  marginBottom: 10,
                }}
              >
                {item.label}
              </div>
              <div
                style={{
                  fontSize: 40,
                  fontWeight: 700,
                  color: item.color,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
