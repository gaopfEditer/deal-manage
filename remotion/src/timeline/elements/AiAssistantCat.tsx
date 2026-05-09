import React from "react";
import { AbsoluteFill } from "remotion";
import type { AiAssistantCatLayer } from "../../lib/types";
import { resolveSemanticPosition } from "../../lib/layout";

type Props = {
  layer: AiAssistantCatLayer;
};

export const AiAssistantCat: React.FC<Props> = ({ layer }) => {
  const { dialog, position } = layer.props;
  const pos = resolveSemanticPosition(
    typeof position === "string" ? position : undefined
  );

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          ...pos,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 12,
          maxWidth: "86%",
        }}
      >
        <div
          style={{
            width: 160,
            height: 160,
            borderRadius: 36,
            background:
              "linear-gradient(145deg, rgba(120,200,255,0.35), rgba(40,80,200,0.55))",
            border: "2px solid rgba(200, 230, 255, 0.55)",
            boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
            display: "grid",
            placeItems: "center",
            fontSize: 72,
          }}
          title={layer.props.action || "assistant"}
        >
          🐱
        </div>
        {dialog ? (
          <div
            style={{
              padding: "14px 18px",
              borderRadius: 16,
              background: "rgba(10, 14, 28, 0.78)",
              border: "1px solid rgba(160, 210, 255, 0.35)",
              color: "#eaf6ff",
              fontSize: 30,
              lineHeight: 1.35,
              maxWidth: 900,
            }}
          >
            {dialog}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
