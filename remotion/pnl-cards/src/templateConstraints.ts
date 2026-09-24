import type { CardTemplate, TemplateConstraints, TextField } from "./types";

export const OKX_CONSTRAINTS: TemplateConstraints = {
  pnlMinRatio: 1.8,
};

export function getTemplateConstraints(
  template: CardTemplate
): TemplateConstraints | null {
  return template.constraints ?? (template.exchange === "okx" ? OKX_CONSTRAINTS : null);
}

export function pctX(x: number, width: number): string {
  return `${((x / width) * 100).toFixed(1)}%`;
}

export function pctY(y: number, height: number): string {
  return `${((y / height) * 100).toFixed(1)}%`;
}

export function validatePnlFontSize(
  fields: TextField[],
  minRatio: number
): string | null {
  const sym = fields.find((f) => f.id === "symbolTitle" || f.id === "symbol");
  const pnl = fields.find((f) => f.id === "pnlPct");
  if (!sym || !pnl) return null;
  if (pnl.fontSize < sym.fontSize * minRatio) {
    return `收益率字号应 ≥ 品种的 ${minRatio} 倍（当前 ${pnl.fontSize} / ${sym.fontSize}）`;
  }
  return null;
}
