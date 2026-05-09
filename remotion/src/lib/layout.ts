import type { CSSProperties } from "react";
import type { SemanticPosition } from "./types";

const SEMANTIC: Record<SemanticPosition, CSSProperties> = {
  top_left: { top: "6%", left: "6%", transform: "none" },
  top_center: { top: "6%", left: "50%", transform: "translateX(-50%)" },
  top_right: { top: "6%", right: "6%", transform: "none" },
  center: { top: "50%", left: "50%", transform: "translate(-50%, -50%)" },
  bottom_left: { bottom: "10%", left: "6%", transform: "none" },
  bottom_center: { bottom: "10%", left: "50%", transform: "translateX(-50%)" },
  bottom_right: { bottom: "10%", right: "6%", transform: "none" },
};

export function resolveSemanticPosition(
  position: string | undefined
): CSSProperties {
  if (!position) return SEMANTIC.bottom_right;
  const key = position as SemanticPosition;
  if (key in SEMANTIC) return SEMANTIC[key];
  return SEMANTIC.bottom_right;
}
