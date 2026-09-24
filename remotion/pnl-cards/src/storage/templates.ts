import { normalizeTemplate } from "../fieldUtils";
import { probeBgSize } from "../probeBgSize";
import type { CardTemplate, Exchange } from "../types";

const STORAGE_PREFIX = "pnl-card-template:";

export function storageKey(exchange: Exchange): string {
  return `${STORAGE_PREFIX}${exchange}`;
}

export function loadTemplateFromStorage(exchange: Exchange): CardTemplate | null {
  try {
    const raw = localStorage.getItem(storageKey(exchange));
    if (!raw) return null;
    return normalizeTemplate(JSON.parse(raw) as CardTemplate);
  } catch {
    return null;
  }
}

export function saveTemplateToStorage(template: CardTemplate): boolean {
  try {
    localStorage.setItem(storageKey(template.exchange), JSON.stringify(template, null, 2));
    return true;
  } catch {
    return false;
  }
}

export function downloadTemplateJson(template: CardTemplate): void {
  const blob = new Blob([JSON.stringify(template, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${template.exchange}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function loadBuiltinTemplate(exchange: Exchange): Promise<CardTemplate> {
  const res = await fetch(`/operate-gate/templates/${exchange}.json`);
  if (!res.ok) throw new Error(`无法加载模板 ${exchange}.json`);
  return normalizeTemplate((await res.json()) as CardTemplate);
}

/** 首次无缓存时加载内置模板，并按底图 PNG 实际像素设默认尺寸 */
export async function resolveTemplate(exchange: Exchange): Promise<CardTemplate> {
  const cached = loadTemplateFromStorage(exchange);
  if (cached) return cached;

  const builtin = await loadBuiltinTemplate(exchange);
  try {
    const { width, height } = await probeBgSize(builtin.bg);
    return normalizeTemplate({
      ...builtin,
      width,
      height,
      bgWidth: width,
      bgHeight: height,
    });
  } catch {
    return builtin;
  }
}
