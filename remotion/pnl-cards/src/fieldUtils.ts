import type { CardTemplate, FieldId, ImageLayer, TextField } from "./types";

export const DEFAULT_FONT =
  '"PingFang SC", "SF Pro Text", "Helvetica Neue", sans-serif';

export const FONT_BOLD =
  '"Inter", "PingFang SC", "DIN Alternate", "Helvetica Neue", sans-serif';

export const FONT_OPTIONS: { label: string; value: string }[] = [
  { label: "苹方 / 系统默认", value: DEFAULT_FONT },
  { label: "PingFang SC", value: '"PingFang SC", sans-serif' },
  { label: "SF Pro", value: '"SF Pro Text", "SF Pro Display", sans-serif' },
  { label: "Helvetica Neue", value: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "DIN / 数字", value: '"DIN Alternate", "Arial Narrow", sans-serif' },
  { label: "Roboto", value: "Roboto, sans-serif" },
  { label: "Noto Sans SC", value: '"Noto Sans SC", sans-serif' },
];

let keySeq = 0;

export function newFieldKey(prefix = "f"): string {
  keySeq += 1;
  return `${prefix}_${Date.now()}_${keySeq}`;
}

export function normalizeField(field: TextField, index: number): TextField {
  return {
    ...field,
    key: field.key || `${field.id}_${index}`,
    fontFamily: field.fontFamily ?? DEFAULT_FONT,
  };
}

export function normalizeTemplate(template: CardTemplate): CardTemplate {
  const seen = new Set<string>();
  const fields = template.fields.map((f, i) => {
    let normalized = normalizeField(f, i);
    if (seen.has(normalized.key)) {
      normalized = { ...normalized, key: newFieldKey(normalized.id) };
    }
    seen.add(normalized.key);
    return normalized;
  });
  const images = (template.images ?? []).map((img, i) => {
    let normalized: ImageLayer = {
      ...img,
      key: img.key || `avatar_${i}`,
      borderRadius: img.borderRadius ?? 9999,
    };
    if (seen.has(normalized.key)) {
      normalized = { ...normalized, key: newFieldKey("avatar") };
    }
    seen.add(normalized.key);
    return normalized;
  });
  return { ...template, fields, images };
}

export function defaultFieldForType(id: FieldId, yOffset = 0): TextField {
  const base: TextField = {
    key: newFieldKey(id),
    id,
    x: 40,
    y: 40 + yOffset,
    fontSize: id === "pnlPct" ? 48 : id === "custom" ? 16 : 14,
    fontWeight: id === "pnlPct" ? 700 : 500,
    color: id === "pnlPct" ? "pnl" : "#ffffff",
    align: "left",
    fontFamily: DEFAULT_FONT,
  };
  if (id === "leverage") return { ...base, suffix: "x" };
  if (id === "inviteCode") return { ...base, prefix: "邀请码 " };
  if (id === "custom") return { ...base, text: "自定义文本" };
  return base;
}

export function duplicateField(field: TextField): TextField {
  return {
    ...field,
    key: newFieldKey(field.id),
    x: field.x + 16,
    y: field.y + 16,
    ...(field.id === "custom"
      ? { text: field.text ? `${field.text} 副本` : "自定义文本" }
      : {}),
  };
}

export function fieldListLabel(field: TextField): string {
  const names: Record<FieldId, string> = {
    symbol: "品种",
    symbolTitle: "品种标题",
    marketLabel: "市场",
    side: "方向",
    sideRow: "方向行",
    leverage: "杠杆",
    status: "状态",
    pnlPct: "收益率",
    entry: "开仓价",
    exit: "平仓/标记价",
    time: "时间",
    nickname: "昵称",
    inviteCode: "邀请码",
    custom: "自定义文本",
  };
  const base = names[field.id];
  if (field.text !== undefined && field.text.trim()) {
    const snippet = field.text.trim().slice(0, 14);
    return `${base}：${snippet}${field.text.length > 14 ? "…" : ""}`;
  }
  return base;
}

export function defaultAvatarLayer(): ImageLayer {
  return {
    key: newFieldKey("avatar"),
    kind: "avatar",
    x: 48,
    y: 48,
    width: 72,
    height: 72,
    borderRadius: 9999,
  };
}

export function duplicateImageLayer(img: ImageLayer): ImageLayer {
  return {
    ...img,
    key: newFieldKey("avatar"),
    x: img.x + 16,
    y: img.y + 16,
  };
}

export function resolveImageSrc(
  layer: ImageLayer,
  avatarUrl?: string
): string | undefined {
  if (layer.kind === "avatar" && avatarUrl?.trim()) return avatarUrl.trim();
  return layer.src?.trim() || undefined;
}
