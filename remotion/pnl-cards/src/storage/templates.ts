import { normalizeTemplate } from "../fieldUtils";
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

export function saveTemplateToStorage(template: CardTemplate): void {
  localStorage.setItem(storageKey(template.exchange), JSON.stringify(template, null, 2));
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

export async function resolveTemplate(exchange: Exchange): Promise<CardTemplate> {
  const cached = loadTemplateFromStorage(exchange);
  if (cached) {
    /** OKX 布局升级：旧版缓存自动丢弃，改用内置 1080×1920 标准模板 */
    if (
      exchange === "okx" &&
      (cached.width !== 1080 ||
        !cached.fields.some((f) => f.id === "symbolTitle" || f.id === "sideRow"))
    ) {
      return loadBuiltinTemplate(exchange);
    }
    return cached;
  }
  return loadBuiltinTemplate(exchange);
}
