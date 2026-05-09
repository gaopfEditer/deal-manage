import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { TextAnnotationLayer } from "../../lib/types";

type Props = {
  layer: TextAnnotationLayer;
};

export const TextAnnotation: React.FC<Props> = ({ layer }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { content, style, animation } = layer.props;

  const enter = spring({
    frame,
    fps,
    config: { damping: 18 },
  });

  const opacity =
    animation === "slide_in_blur"
      ? interpolate(enter, [0, 1], [0, 1])
      : interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });

  const translateY =
    animation === "slide_in_blur"
      ? interpolate(enter, [0, 1], [40, 0])
      : interpolate(frame, [0, 12], [24, 0], { extrapolateRight: "clamp" });

  const blurPx =
    animation === "slide_in_blur"
      ? interpolate(enter, [0, 1], [12, 0])
      : interpolate(frame, [0, 12], [8, 0], { extrapolateRight: "clamp" });

  const customStyle: React.CSSProperties = {};
  if (style && typeof style === "object") {
    for (const [k, v] of Object.entries(style)) {
      (customStyle as Record<string, string | number>)[k] = v;
    }
  }

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          maxWidth: "88%",
          padding: "18px 22px",
          borderRadius: 14,
          background: "rgba(8, 12, 24, 0.72)",
          border: "1px solid rgba(120, 200, 255, 0.35)",
          color: "#e8f6ff",
          fontSize: 40,
          fontWeight: 700,
          lineHeight: 1.25,
          opacity,
          transform: `translateY(${translateY}px)`,
          filter: `blur(${blurPx}px)`,
          textShadow: "0 2px 18px rgba(0,0,0,0.55)",
          ...customStyle,
        }}
      >
        {content}
      </div>
    </AbsoluteFill>
  );
};
