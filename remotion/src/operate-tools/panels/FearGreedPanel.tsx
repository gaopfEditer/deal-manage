import React, { useState } from "react";

export const FearGreedPanel: React.FC = () => {
  const [score, setScore] = useState(72);
  const [jitter, setJitter] = useState(0);
  const display = Math.max(0, Math.min(100, Math.round(score + jitter)));
  const angle = -90 + (display / 100) * 180;
  const label =
    display < 20
      ? "极度恐慌 Extreme Fear"
      : display < 40
        ? "恐慌 Fear"
        : display < 60
          ? "中性 Neutral"
          : display < 80
            ? "贪婪 Greed"
            : "极度贪婪 Extreme Greed";
  const hist =
    display >= 90 ? -18 : display >= 80 ? -12 : display <= 10 ? 14 : display <= 20 ? 9 : -3;

  const shake = () => {
    let n = 0;
    const id = setInterval(() => {
      setJitter((Math.random() - 0.5) * 10);
      n += 1;
      if (n > 14) {
        clearInterval(id);
        setJitter(0);
      }
    }, 50);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
        <input
          type="range"
          min={0}
          max={100}
          value={score}
          onChange={(e) => setScore(Number(e.target.value))}
          style={{ width: 280 }}
        />
        <button type="button" style={btnStyle} onClick={shake}>
          抖动指针
        </button>
        <button
          type="button"
          style={btnGhost}
          onClick={() => {
            setScore(Math.random() > 0.5 ? 92 + Math.random() * 7 : 5 + Math.random() * 8);
            shake();
          }}
        >
          随机爆表
        </button>
        <span style={tagStyle}>{label}</span>
      </div>
      <div style={wrapStyle}>
        <div style={{ position: "relative", width: 420, height: 240 }}>
          <div style={arcStyle} />
          <div
            style={{
              position: "absolute",
              left: "50%",
              bottom: 8,
              width: 4,
              height: 150,
              background: "linear-gradient(#fff, #ff7b72)",
              transformOrigin: "bottom center",
              borderRadius: 4,
              boxShadow: "0 0 12px rgba(255,123,114,0.8)",
              transform: `translateX(-50%) rotate(${angle}deg)`,
              transition: "transform 0.12s ease-out",
            }}
          />
          <div style={hubStyle} />
          <div style={scoreStyle}>{display}</div>
          <div style={{ position: "absolute", left: 8, bottom: -8, color: "#8b949e", fontSize: 13 }}>
            极度恐慌
          </div>
          <div style={{ position: "absolute", right: 8, bottom: -8, color: "#8b949e", fontSize: 13 }}>
            极度贪婪
          </div>
        </div>
        <div style={{ color: "#c9d1d9", fontSize: 14, textAlign: "center", maxWidth: 640, lineHeight: 1.6 }}>
          历史同档（{display}）后 7 日平均回调约{" "}
          <strong style={{ color: "#ff7b72" }}>{hist}%</strong>
          · 适合 10 秒情绪短视频口播
        </div>
      </div>
    </div>
  );
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
const btnGhost: React.CSSProperties = { ...btnStyle, background: "#21262d", color: "#e6edf3" };
const tagStyle: React.CSSProperties = {
  background: "#21262d",
  border: "1px solid #30363d",
  borderRadius: 999,
  padding: "6px 12px",
  fontSize: 12,
  color: "#ffdcd7",
};
const wrapStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 20,
  padding: 24,
  background: "radial-gradient(circle at 50% 20%, #1a1030 0%, #0d1117 55%)",
  border: "1px solid #30363d",
  borderRadius: 16,
};
const arcStyle: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: 0,
  width: 400,
  height: 200,
  transform: "translateX(-50%)",
  borderRadius: "400px 400px 0 0",
  background:
    "conic-gradient(from 180deg at 50% 100%, #3fb950 0deg, #e3b341 60deg, #f0883e 120deg, #ff7b72 180deg, transparent 180deg)",
  WebkitMask: "radial-gradient(circle at 50% 100%, transparent 110px, #000 112px)",
  mask: "radial-gradient(circle at 50% 100%, transparent 110px, #000 112px)",
  filter: "drop-shadow(0 0 18px rgba(240,136,62,0.35))",
};
const hubStyle: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: 0,
  width: 28,
  height: 28,
  transform: "translate(-50%, 40%)",
  borderRadius: "50%",
  background: "#c9d1d9",
  border: "4px solid #484f58",
};
const scoreStyle: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: 48,
  transform: "translateX(-50%)",
  fontSize: 48,
  fontWeight: 900,
  color: "#ffdcd7",
  textShadow: "0 0 20px rgba(255,100,80,0.6)",
};
