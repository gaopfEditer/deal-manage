import { normalizeTemplate } from "../fieldUtils";
import { probeBgSize } from "../probeBgSize";
import type { CardTemplate, Exchange } from "../types";

export { DEFAULT_BG, migrateBgPath } from "../defaults";

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
async function syncBgDimensions(template: CardTemplate): Promise<CardTemplate> {
  try {
    const { width, height } = await probeBgSize(template.bg);
    const bgW = template.bgWidth ?? template.width;
    const bgH = template.bgHeight ?? template.height;
    if (bgW !== width || bgH !== height) {
      return normalizeTemplate({
        ...template,
        width,
        height,
        bgWidth: width,
        bgHeight: height,
      });
    }
  } catch {
    /* 底图暂不可达时保留原尺寸 */
  }
  return template;
}

export async function resolveTemplate(exchange: Exchange): Promise<CardTemplate> {
  const cached = loadTemplateFromStorage(exchange);
  const base = cached
    ? normalizeTemplate(cached)
    : normalizeTemplate(await loadBuiltinTemplate(exchange));
  const synced = await syncBgDimensions(base);
  if (cached && synced.fields.length !== cached.fields.length) {
    saveTemplateToStorage(synced);
  }
  return synced;
}
