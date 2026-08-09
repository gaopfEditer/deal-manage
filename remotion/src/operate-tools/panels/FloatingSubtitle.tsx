import React, { useCallback, useRef, useState } from "react";
import { SUBTITLE_TOKEN_HELP, type SubtitleCue } from "../../lib/priceSource";

type Props = {
  cue: SubtitleCue;
  /** 插值后的展示文案 */
  displayText: string;
  stageRef: React.RefObject<HTMLDivElement | null>;
  editing: boolean;
  selected: boolean;
  assetLabels: string[];
  onSelect: () => void;
  onChange: (patch: Partial<SubtitleCue>) => void;
  onRemove: () => void;
};

/** 悬浮字幕：可拖位置，选中后改内容/大小/颜色；支持 {date}/{pnl} 插值 */
export const FloatingSubtitle: React.FC<Props> = ({
  cue,
  displayText,
  stageRef,
  editing,
  selected,
  assetLabels,
  onSelect,
  onChange,
  onRemove,
}) => {
  const dragging = useRef(false);
  const [panelPos, setPanelPos] = useState<"above" | "below">("above");
  const taRef = useRef<HTMLTextAreaElement>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!editing) return;
      e.preventDefault();
      e.stopPropagation();
      onSelect();
      const stage = stageRef.current;
      if (!stage) return;
      dragging.current = true;
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

      const move = (ev: PointerEvent) => {
        if (!dragging.current || !stageRef.current) return;
        const rect = stageRef.current.getBoundingClientRect();
        const x = Math.min(100, Math.max(0, ((ev.clientX - rect.left) / rect.width) * 100));
        const y = Math.min(100, Math.max(0, ((ev.clientY - rect.top) / rect.height) * 100));
        onChange({ x, y });
        setPanelPos(y < 28 ? "below" : "above");
      };
      const up = () => {
        dragging.current = false;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [editing, onChange, onSelect, stageRef]
  );

  const insertToken = (token: string) => {
    const el = taRef.current;
    if (!el) {
      onChange({ text: `${cue.text}${token}` });
      return;
    }
    const start = el.selectionStart ?? cue.text.length;
    const end = el.selectionEnd ?? start;
    const next = cue.text.slice(0, start) + token + cue.text.slice(end);
    onChange({ text: next });
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const transform =
    cue.align === "center"
      ? "translate(-50%, -50%)"
      : cue.align === "right"
        ? "translate(-100%, -50%)"
        : "translate(0, -50%)";

  const chips = [
    ...SUBTITLE_TOKEN_HELP.map((t) => t.token),
    ...assetLabels.flatMap((lab) => [
      `{price:${lab}}`,
      `{value:${lab}}`,
      `{pnl:${lab}}`,
      `{pnlPct:${lab}}`,
    ]),
  ];

  return (
    <div
      style={{
        position: "absolute",
        left: `${cue.x}%`,
        top: `${cue.y}%`,
        transform,
        zIndex: selected ? 20 : 10,
        pointerEvents: editing ? "auto" : "none",
        maxWidth: "92%",
      }}
    >
      <div
        onPointerDown={onPointerDown}
        onClick={(e) => {
          if (!editing) return;
          e.stopPropagation();
          onSelect();
        }}
        style={{
          fontSize: cue.fontSize,
          color: cue.color,
          fontWeight: 700,
          textShadow: "0 2px 12px rgba(0,0,0,0.85)",
          textAlign: cue.align,
          whiteSpace: "pre-wrap",
          cursor: editing ? "grab" : "default",
          outline: editing
            ? selected
              ? "2px solid #f0883e"
              : "1px dashed rgba(240,136,62,0.45)"
            : "none",
          outlineOffset: 6,
          padding: editing ? "2px 6px" : 0,
          borderRadius: 6,
          background: editing && selected ? "rgba(13,17,23,0.55)" : "transparent",
          userSelect: "none",
        }}
      >
        {displayText || (editing ? "（空字幕）" : "")}
      </div>

      {editing && selected ? (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            left: "50%",
            ...(panelPos === "above"
              ? { bottom: "100%", marginBottom: 10 }
              : { top: "100%", marginTop: 10 }),
            transform: "translateX(-50%)",
            width: 360,
            padding: 10,
            borderRadius: 12,
            border: "1px solid #30363d",
            background: "rgba(22,27,34,0.98)",
            boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            pointerEvents: "auto",
            zIndex: 30,
          }}
        >
          <div style={{ color: "#8b949e", fontSize: 11 }}>
            模板（插值语法）· 舞台显示已替换后的结果
          </div>
          <textarea
            ref={taRef}
            value={cue.text}
            onChange={(e) => onChange({ text: e.target.value })}
            rows={3}
            placeholder={"{date}\n{pnlLines}"}
            style={field}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxHeight: 72, overflow: "auto" }}>
            {chips.map((token) => (
              <button
                key={token}
                type="button"
                title={token}
                style={chipBtn}
                onClick={() => insertToken(token)}
              >
                {token}
              </button>
            ))}
          </div>
          <div style={row}>
            <label style={lab}>
              字号
              <input
                type="number"
                min={12}
                max={120}
                value={cue.fontSize}
                onChange={(e) => onChange({ fontSize: Number(e.target.value) || 28 })}
                style={{ ...field, width: 64, marginLeft: 4 }}
              />
            </label>
            <label style={lab}>
              颜色
              <input
                type="color"
                value={cue.color}
                onChange={(e) => onChange({ color: e.target.value })}
                style={{ width: 40, height: 28, marginLeft: 4, border: "none", background: "transparent" }}
              />
            </label>
            <label style={lab}>
              对齐
              <select
                value={cue.align}
                onChange={(e) =>
                  onChange({ align: e.target.value as SubtitleCue["align"] })
                }
                style={{ ...field, width: 72, marginLeft: 4 }}
              >
                <option value="left">左</option>
                <option value="center">中</option>
                <option value="right">右</option>
              </select>
            </label>
          </div>
          <div style={row}>
            <span style={{ color: "#8b949e", fontSize: 11 }}>
              位置 {cue.x.toFixed(0)}% · {cue.y.toFixed(0)}%（拖拽）
            </span>
          </div>
          <div style={row}>
            <label style={lab}>
              <input
                type="checkbox"
                checked={cue.showOnStop}
                onChange={(e) => onChange({ showOnStop: e.target.checked })}
              />
              仅停止/播完时显示
            </label>
          </div>
          <div style={{ color: "#8b949e", fontSize: 10, lineHeight: 1.4 }}>
            不勾选且不填时间轴 = 播放中一直显示。填时间轴则只在该日期区间显示。
          </div>
          <div style={row}>
            <label style={lab}>
              时间轴
              <input
                type="date"
                value={cue.startDate}
                onChange={(e) => onChange({ startDate: e.target.value })}
                style={{ ...field, width: 128, marginLeft: 4 }}
              />
              <span style={{ margin: "0 4px", color: "#8b949e" }}>–</span>
              <input
                type="date"
                value={cue.endDate}
                onChange={(e) => onChange({ endDate: e.target.value })}
                style={{ ...field, width: 128 }}
              />
            </label>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" style={dangerBtn} onClick={onRemove}>
              删除
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const field: React.CSSProperties = {
  background: "#0d1117",
  border: "1px solid #30363d",
  color: "#e6edf3",
  borderRadius: 8,
  padding: "6px 8px",
  fontSize: 12,
  width: "100%",
  boxSizing: "border-box",
  resize: "vertical",
};
const row: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  alignItems: "center",
};
const lab: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  color: "#8b949e",
  fontSize: 11,
};
const chipBtn: React.CSSProperties = {
  background: "#21262d",
  border: "1px solid #30363d",
  color: "#79c0ff",
  borderRadius: 6,
  padding: "2px 6px",
  fontSize: 10,
  cursor: "pointer",
  fontFamily: "ui-monospace, monospace",
};
const dangerBtn: React.CSSProperties = {
  background: "#3d1f1f",
  border: "1px solid #f85149",
  color: "#ff7b72",
  borderRadius: 8,
  padding: "5px 10px",
  cursor: "pointer",
  fontSize: 12,
};
