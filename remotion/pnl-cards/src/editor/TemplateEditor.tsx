import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAutoSave } from "../hooks/useAutoSave";
import { CardPreview } from "../preview/CardPreview";
import {
  downloadTemplateJson,
  loadBuiltinTemplate,
  resolveTemplate,
  saveTemplateToStorage,
} from "../storage/templates";
import {
  defaultAvatarLayer,
  defaultFieldForType,
  duplicateField,
  duplicateImageLayer,
  fieldListLabel,
  FONT_OPTIONS,
} from "../fieldUtils";
import { ALL_FIELD_IDS, computePnl, resolveFieldBody } from "../formatField";
import { probeBgSize } from "../probeBgSize";
import {
  getTemplateConstraints,
  pctX,
  pctY,
  validatePnlFontSize,
} from "../templateConstraints";
import { FIELD_LABELS } from "../types";
import type { EditorSelection, FieldId, ImageLayer } from "../types";
import type { CardTemplate, Exchange, TextField, TradeInput } from "../types";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

const SAMPLE_TRADE: TradeInput = {
  symbol: "BTCUSDT",
  market: "swap",
  side: "long",
  leverage: 20,
  status: "closed",
  entry: 65000,
  exit: 66300,
  time: "2026/09/23 22:40:13 (UTC+8)",
  nickname: "示例昵称",
  inviteCode: "ABC123",
};

type Props = {
  exchange: Exchange;
  onExchangeChange: (ex: Exchange) => void;
  /** 供出图模式读取最新模板，保证所见即所得 */
  onTemplateChange?: (template: CardTemplate) => void;
};

export const TemplateEditor: React.FC<Props> = ({
  exchange,
  onExchangeChange,
  onTemplateChange,
}) => {
  const [template, setTemplate] = useState<CardTemplate | null>(null);
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [status, setStatus] = useState("");
  const [bgProbe, setBgProbe] = useState<{ width: number; height: number } | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const prevBgPathRef = useRef<string | undefined>(undefined);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);

  const persistTemplate = useCallback((t: CardTemplate) => {
    if (!saveTemplateToStorage(t)) {
      setStatus("模板过大，无法写入本地缓存（可移除模板内嵌头像后重试）");
      setTimeout(() => setStatus(""), 5000);
    }
  }, []);
  useAutoSave(template, persistTemplate, exchange);

  useEffect(() => {
    if (template) onTemplateChange?.(template);
  }, [template, onTemplateChange]);

  useEffect(() => {
    prevBgPathRef.current = undefined;
    let cancelled = false;
    void resolveTemplate(exchange).then((t) => {
      if (!cancelled) {
        setTemplate(t);
        const first = t.fields[0];
        setSelection(first ? { kind: "field", key: first.key } : null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [exchange]);

  /** 仅探测底图像素；更换底图路径时才自动同步尺寸（刷新不覆盖已保存模板） */
  useEffect(() => {
    if (!template?.bg) return;
    const bgPath = template.bg;
    const bgPathChanged =
      prevBgPathRef.current !== undefined && prevBgPathRef.current !== bgPath;
    prevBgPathRef.current = bgPath;

    let cancelled = false;
    void probeBgSize(bgPath)
      .then(({ width, height }) => {
        if (cancelled) return;
        setBgProbe({ width, height });
        if (bgPathChanged) {
          setTemplate((t) => {
            if (!t || t.bg !== bgPath) return t;
            return {
              ...t,
              width,
              height,
              bgWidth: width,
              bgHeight: height,
            };
          });
        }
      })
      .catch(() => {
        if (!cancelled) setBgProbe(null);
      });
    return () => {
      cancelled = true;
    };
  }, [template?.bg, exchange]);

  const selectedField =
    selection?.kind === "field"
      ? (template?.fields.find((f) => f.key === selection.key) ?? null)
      : null;
  const selectedImage =
    selection?.kind === "image"
      ? (template?.images?.find((img) => img.key === selection.key) ?? null)
      : null;

  const samplePnl = useMemo(() => computePnl(SAMPLE_TRADE), []);
  const selectedFieldAutoText = useMemo(() => {
    if (!selectedField) return "";
    return resolveFieldBody(
      { ...selectedField, text: undefined },
      SAMPLE_TRADE,
      samplePnl
    );
  }, [selectedField, samplePnl]);

  const sizeMismatch =
    bgProbe &&
    template &&
    ((template.bgWidth ?? template.width) !== bgProbe.width ||
      (template.bgHeight ?? template.height) !== bgProbe.height);

  const applyBgSize = async (syncCanvas: boolean) => {
    if (!template) return;
    try {
      const { width, height } = await probeBgSize(template.bg);
      setBgProbe({ width, height });
      setTemplate({
        ...template,
        bgWidth: width,
        bgHeight: height,
        ...(syncCanvas ? { width, height } : {}),
      });
      setStatus(
        syncCanvas
          ? `画布与底图已设为 ${width}×${height}`
          : `底图尺寸已设为 ${width}×${height}`
      );
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
      setTimeout(() => setStatus(""), 4000);
    }
  };

  const updateField = (key: string, patch: Partial<TextField>) => {
    setTemplate((t) => {
      if (!t) return t;
      return {
        ...t,
        fields: t.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)),
      };
    });
  };

  const constraints = template ? getTemplateConstraints(template) : null;
  const pnlWarn =
    template && constraints?.pnlMinRatio
      ? validatePnlFontSize(template.fields, constraints.pnlMinRatio)
      : null;

  const moveField = (key: string, x: number, y: number) => {
    updateField(key, { x, y });
  };

  const addField = (id: FieldId) => {
    if (!template) return;
    const field = defaultFieldForType(id, template.fields.length * 36);
    setTemplate({ ...template, fields: [...template.fields, field] });
    setSelection({ kind: "field", key: field.key });
  };

  const updateImage = (key: string, patch: Partial<ImageLayer>) => {
    setTemplate((t) => {
      if (!t) return t;
      return {
        ...t,
        images: (t.images ?? []).map((img) =>
          img.key === key ? { ...img, ...patch } : img
        ),
      };
    });
  };

  const moveImage = (key: string, x: number, y: number) => {
    updateImage(key, { x, y });
  };

  const addAvatar = () => {
    if (!template) return;
    const layer = defaultAvatarLayer();
    setTemplate({
      ...template,
      images: [...(template.images ?? []), layer],
    });
    setSelection({ kind: "image", key: layer.key });
  };

  const duplicateSelection = useCallback(() => {
    if (!template || !selection) return;
    if (selection.kind === "field") {
      const src = template.fields.find((f) => f.key === selection.key);
      if (!src) return;
      const copy = duplicateField(src);
      setTemplate({ ...template, fields: [...template.fields, copy] });
      setSelection({ kind: "field", key: copy.key });
      setStatus("已复制字段");
    } else {
      const src = template.images?.find((img) => img.key === selection.key);
      if (!src) return;
      const copy = duplicateImageLayer(src);
      setTemplate({ ...template, images: [...(template.images ?? []), copy] });
      setSelection({ kind: "image", key: copy.key });
      setStatus("已复制头像");
    }
    setTimeout(() => setStatus(""), 1500);
  }, [template, selection]);

  const deleteSelection = useCallback(() => {
    if (!template || !selection) return;
    if (selection.kind === "field") {
      setTemplate({
        ...template,
        fields: template.fields.filter((f) => f.key !== selection.key),
      });
    } else {
      setTemplate({
        ...template,
        images: (template.images ?? []).filter((img) => img.key !== selection.key),
      });
    }
    setSelection(null);
    setStatus("已删除");
    setTimeout(() => setStatus(""), 1500);
  }, [template, selection]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "c" && selection) {
        e.preventDefault();
        duplicateSelection();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selection) {
        e.preventDefault();
        deleteSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selection, duplicateSelection, deleteSelection]);

  const onAvatarFile = async (file: File | undefined) => {
    if (!file || !selectedImage) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      updateImage(selectedImage.key, { src: dataUrl });
      setStatus("头像 PNG 已载入");
      setTimeout(() => setStatus(""), 2000);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const save = () => {
    if (!template) return;
    if (saveTemplateToStorage(template)) {
      setStatus(`已同步到本地缓存 · ${template.exchange}`);
    } else {
      setStatus("写入失败：模板过大，请移除模板内嵌头像后重试");
    }
    setTimeout(() => setStatus(""), 3000);
  };

  const download = () => {
    if (!template) return;
    downloadTemplateJson(template);
    setStatus(`已下载 ${template.exchange}.json`);
    setTimeout(() => setStatus(""), 3000);
  };

  const reset = async () => {
    const t = await loadBuiltinTemplate(exchange);
    setTemplate(t);
    setStatus("已恢复内置模板");
    setTimeout(() => setStatus(""), 3000);
  };

  if (!template) {
    return <div style={{ color: "#8b949e", padding: 24 }}>加载模板…</div>;
  }

  return (
    <div style={layout}>
      <div style={leftPane}>
        <div style={toolbar}>
          <span style={{ color: "#8b949e", fontSize: 12 }}>
            拖拽吸附对齐 · ⌘C 复制 · Delete 删除 · 改动自动缓存
          </span>
          {status ? <span style={{ color: "#3fb950", fontSize: 12 }}>{status}</span> : null}
          {dragPos && template ? (
            <span style={{ color: "#58a6ff", fontSize: 12, fontFamily: "monospace" }}>
              {dragPos.x}px, {dragPos.y}px · {pctX(dragPos.x, template.width)}{" "}
              {pctY(dragPos.y, template.height)}
            </span>
          ) : null}
          {pnlWarn ? <span style={{ color: "#f0883e", fontSize: 12 }}>{pnlWarn}</span> : null}
        </div>
        <div ref={canvasWrapRef} style={canvasWrap} tabIndex={0}>
          <CardPreview
            template={template}
            trade={SAMPLE_TRADE}
            cardId="card-editor"
            selection={selection}
            onSelect={setSelection}
            onMoveField={moveField}
            onMoveImage={moveImage}
            onDragPosition={setDragPos}
            editable
          />
        </div>
      </div>

      <aside style={rightPane}>
        <label style={label}>
          交易所
          <select
            value={exchange}
            onChange={(e) => onExchangeChange(e.target.value as Exchange)}
            style={input}
          >
            <option value="okx">OKX</option>
            <option value="gate">Gate</option>
            <option value="binance">币安</option>
            <option value="bitget">Bitget</option>
          </select>
        </label>

        <div style={section}>
          <div style={sectionTitle}>底图</div>
          <label style={label}>
            路径
            <input
              value={template.bg}
              onChange={(e) => setTemplate({ ...template, bg: e.target.value })}
              style={input}
              placeholder="/operate-gate/backgrounds/okx.png"
            />
          </label>
          {bgProbe ? (
            <div style={{ fontSize: 11, color: "#8b949e" }}>
              文件实际像素：{bgProbe.width} × {bgProbe.height}
            </div>
          ) : null}
          {sizeMismatch ? (
            <div style={warnBox}>
              画布/底图尺寸与 PNG 不一致，底图会被拉伸或裁切。请点「同步画布尺寸」。
            </div>
          ) : null}
        </div>

        <div style={section}>
          <div style={sectionTitle}>画布尺寸（导出 & 坐标）</div>
          <div style={{ fontSize: 11, color: "#8b949e", lineHeight: 1.5 }}>
            首次使用按底图尺寸初始化；编辑后自动缓存，刷新保留。更换底图路径时同步尺寸。
          </div>
          <label style={label}>
            宽
            <input
              type="number"
              min={1}
              value={template.width}
              onChange={(e) =>
                setTemplate({
                  ...template,
                  width: Math.max(1, Math.round(Number(e.target.value) || 1)),
                })
              }
              style={input}
            />
          </label>
          <label style={label}>
            高
            <input
              type="number"
              min={1}
              value={template.height}
              onChange={(e) =>
                setTemplate({
                  ...template,
                  height: Math.max(1, Math.round(Number(e.target.value) || 1)),
                })
              }
              style={input}
            />
          </label>
        </div>

        <div style={section}>
          <div style={sectionTitle}>底图渲染尺寸（1:1 不拉伸）</div>
          <label style={label}>
            底图宽
            <input
              type="number"
              min={1}
              value={template.bgWidth ?? template.width}
              onChange={(e) =>
                setTemplate({
                  ...template,
                  bgWidth: Math.max(1, Math.round(Number(e.target.value) || 1)),
                })
              }
              style={input}
            />
          </label>
          <label style={label}>
            底图高
            <input
              type="number"
              min={1}
              value={template.bgHeight ?? template.height}
              onChange={(e) =>
                setTemplate({
                  ...template,
                  bgHeight: Math.max(1, Math.round(Number(e.target.value) || 1)),
                })
              }
              style={input}
            />
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button type="button" style={btnPrimary} onClick={() => void applyBgSize(true)}>
              读取底图并同步画布
            </button>
            <button type="button" style={btnGhost} onClick={() => void applyBgSize(false)}>
              仅读取底图尺寸
            </button>
          </div>
        </div>

        <div style={section}>
          <div style={sectionTitle}>添加字段</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {ALL_FIELD_IDS.map((id) => (
              <button key={id} type="button" style={chip} onClick={() => addField(id)}>
                {FIELD_LABELS[id]} +
              </button>
            ))}
            <button type="button" style={chip} onClick={() => addField("custom")}>
              {FIELD_LABELS.custom} +
            </button>
            <button type="button" style={chipAvatar} onClick={addAvatar}>
              头像 +
            </button>
          </div>
        </div>

        <div style={section}>
          <div style={sectionTitle}>图层</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {template.fields.length === 0 && (template.images?.length ?? 0) === 0 ? (
              <div style={{ color: "#8b949e", fontSize: 11 }}>暂无图层</div>
            ) : null}
            {template.fields.map((f) => (
              <button
                key={f.key}
                type="button"
                style={{
                  ...fieldRowMain,
                  ...(selection?.kind === "field" && selection.key === f.key
                    ? fieldRowActive
                    : fieldRowIdle),
                }}
                onClick={() => setSelection({ kind: "field", key: f.key })}
              >
                <span style={{ fontWeight: 600 }}>{fieldListLabel(f)}</span>
                <span style={{ color: "#8b949e", fontSize: 10 }}>
                  文本 · {f.fontSize}px · {f.x},{f.y}
                </span>
              </button>
            ))}
            {(template.images ?? []).map((img) => (
              <button
                key={img.key}
                type="button"
                style={{
                  ...fieldRowMain,
                  ...(selection?.kind === "image" && selection.key === img.key
                    ? fieldRowActiveImage
                    : fieldRowIdle),
                }}
                onClick={() => setSelection({ kind: "image", key: img.key })}
              >
                <span style={{ fontWeight: 600 }}>头像</span>
                <span style={{ color: "#8b949e", fontSize: 10 }}>
                  {img.width}×{img.height} · {img.x},{img.y}
                </span>
              </button>
            ))}
          </div>
        </div>

        {selectedField ? (
          <div style={section}>
            <div style={sectionTitle}>{fieldListLabel(selectedField)}</div>
            <label style={label}>
              类型
              <select
                value={selectedField.id}
                onChange={(e) =>
                  updateField(selectedField.key, { id: e.target.value as FieldId })
                }
                style={input}
              >
                {[...ALL_FIELD_IDS, "custom" as FieldId].map((id) => (
                  <option key={id} value={id}>
                    {FIELD_LABELS[id]}
                  </option>
                ))}
              </select>
            </label>
            <label style={label}>
              显示文本
              <textarea
                value={
                  selectedField.text !== undefined
                    ? selectedField.text
                    : selectedFieldAutoText
                }
                onChange={(e) =>
                  updateField(selectedField.key, { text: e.target.value })
                }
                rows={3}
                style={{ ...input, resize: "vertical", fontFamily: "inherit" }}
                placeholder="输入要显示的文字"
              />
            </label>
            {selectedField.text !== undefined ? (
              <button
                type="button"
                style={btnGhost}
                onClick={() =>
                  updateField(selectedField.key, { text: undefined })
                }
              >
                恢复跟随表单/自动
              </button>
            ) : (
              <div style={{ fontSize: 11, color: "#8b949e", lineHeight: 1.5 }}>
                当前跟随出图表单自动填充；编辑后将固定为该文本（前缀/后缀仍生效）。
              </div>
            )}
            <label style={label}>
              X
              <input
                type="number"
                value={selectedField.x}
                onChange={(e) =>
                  updateField(selectedField.key, {
                    x: Math.round(Number(e.target.value) || 0),
                  })
                }
                style={input}
              />
            </label>
            <label style={label}>
              Y
              <input
                type="number"
                value={selectedField.y}
                onChange={(e) =>
                  updateField(selectedField.key, {
                    y: Math.round(Number(e.target.value) || 0),
                  })
                }
                style={input}
              />
            </label>
            <label style={label}>
              字体
              <select
                value={selectedField.fontFamily ?? FONT_OPTIONS[0].value}
                onChange={(e) =>
                  updateField(selectedField.key, { fontFamily: e.target.value })
                }
                style={input}
              >
                {FONT_OPTIONS.map((o) => (
                  <option key={o.label} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={label}>
              自定义 font-family
              <input
                value={selectedField.fontFamily ?? ""}
                onChange={(e) =>
                  updateField(selectedField.key, {
                    fontFamily: e.target.value || undefined,
                  })
                }
                style={input}
                placeholder='如 "Arial Black", sans-serif'
              />
            </label>
            <label style={label}>
              字号
              <input
                type="number"
                value={selectedField.fontSize}
                onChange={(e) =>
                  updateField(selectedField.key, {
                    fontSize: Number(e.target.value) || 12,
                  })
                }
                style={input}
              />
            </label>
            <label style={label}>
              字重
              <input
                type="number"
                step={100}
                value={selectedField.fontWeight}
                onChange={(e) =>
                  updateField(selectedField.key, {
                    fontWeight: Number(e.target.value) || 400,
                  })
                }
                style={input}
              />
            </label>
            <label style={label}>
              颜色
              <select
                value={selectedField.color === "pnl" ? "pnl" : "custom"}
                onChange={(e) =>
                  updateField(selectedField.key, {
                    color:
                      e.target.value === "pnl"
                        ? "pnl"
                        : selectedField.color === "pnl"
                          ? "#ffffff"
                          : selectedField.color,
                  })
                }
                style={input}
              >
                <option value="pnl">涨跌色 (pnl)</option>
                <option value="custom">固定色</option>
              </select>
            </label>
            {selectedField.color !== "pnl" ? (
              <label style={label}>
                固定色值
                <input
                  type="color"
                  value={
                    selectedField.color.startsWith("#") ? selectedField.color : "#ffffff"
                  }
                  onChange={(e) =>
                    updateField(selectedField.key, { color: e.target.value })
                  }
                  style={{ ...input, padding: 2, height: 36 }}
                />
              </label>
            ) : null}
            <label style={label}>
              对齐
              <select
                value={selectedField.align}
                onChange={(e) =>
                  updateField(selectedField.key, {
                    align: e.target.value as TextField["align"],
                  })
                }
                style={input}
              >
                <option value="left">左</option>
                <option value="center">中</option>
                <option value="right">右</option>
              </select>
            </label>
            <label style={label}>
              前缀
              <input
                value={selectedField.prefix ?? ""}
                onChange={(e) =>
                  updateField(selectedField.key, { prefix: e.target.value || undefined })
                }
                style={input}
                placeholder="如 邀请码 "
              />
            </label>
            <label style={label}>
              后缀
              <input
                value={selectedField.suffix ?? ""}
                onChange={(e) =>
                  updateField(selectedField.key, { suffix: e.target.value || undefined })
                }
                style={input}
                placeholder="如 x / %"
              />
            </label>
          </div>
        ) : selectedImage ? (
          <div style={section}>
            <div style={sectionTitle}>头像</div>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: "none" }}
              onChange={(e) => void onAvatarFile(e.target.files?.[0])}
            />
            <button
              type="button"
              style={btnPrimary}
              onClick={() => avatarInputRef.current?.click()}
            >
              选择头像 PNG
            </button>
            <label style={label}>
              X
              <input
                type="number"
                value={selectedImage.x}
                onChange={(e) =>
                  updateImage(selectedImage.key, {
                    x: Math.round(Number(e.target.value) || 0),
                  })
                }
                style={input}
              />
            </label>
            <label style={label}>
              Y
              <input
                type="number"
                value={selectedImage.y}
                onChange={(e) =>
                  updateImage(selectedImage.key, {
                    y: Math.round(Number(e.target.value) || 0),
                  })
                }
                style={input}
              />
            </label>
            <label style={label}>
              宽
              <input
                type="number"
                min={1}
                value={selectedImage.width}
                onChange={(e) =>
                  updateImage(selectedImage.key, {
                    width: Math.max(1, Math.round(Number(e.target.value) || 1)),
                  })
                }
                style={input}
              />
            </label>
            <label style={label}>
              高
              <input
                type="number"
                min={1}
                value={selectedImage.height}
                onChange={(e) =>
                  updateImage(selectedImage.key, {
                    height: Math.max(1, Math.round(Number(e.target.value) || 1)),
                  })
                }
                style={input}
              />
            </label>
            <label style={label}>
              圆角
              <input
                type="number"
                min={0}
                value={(selectedImage.borderRadius ?? 9999) >= 9999 ? 9999 : selectedImage.borderRadius ?? 0}
                onChange={(e) =>
                  updateImage(selectedImage.key, {
                    borderRadius: Number(e.target.value) || 0,
                  })
                }
                style={input}
              />
            </label>
            <div style={{ fontSize: 11, color: "#8b949e" }}>圆角 9999 = 圆形</div>
          </div>
        ) : (
          <div style={{ color: "#8b949e", fontSize: 12 }}>在编辑区点击选中图层</div>
        )}

        <div style={section}>
          <div style={sectionTitle}>涨跌色</div>
          <label style={label}>
            涨
            <input
              type="color"
              value={template.pnlUpColor}
              onChange={(e) => setTemplate({ ...template, pnlUpColor: e.target.value })}
              style={{ ...input, padding: 2, height: 36 }}
            />
          </label>
          <label style={label}>
            跌
            <input
              type="color"
              value={template.pnlDownColor}
              onChange={(e) => setTemplate({ ...template, pnlDownColor: e.target.value })}
              style={{ ...input, padding: 2, height: 36 }}
            />
          </label>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button type="button" style={btnPrimary} onClick={save}>
            立即同步缓存
          </button>
          <button type="button" style={btnGhost} onClick={download}>
            下载 JSON
          </button>
          <button type="button" style={btnGhost} onClick={() => void reset()}>
            恢复内置模板
          </button>
        </div>
      </aside>
    </div>
  );
};

const layout: React.CSSProperties = {
  display: "flex",
  gap: 16,
  minHeight: 0,
  flex: 1,
  overflow: "hidden",
};

const leftPane: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  overflow: "auto",
};

const canvasWrap: React.CSSProperties = {
  padding: 16,
  background: "#161b22",
  borderRadius: 12,
  border: "1px solid #30363d",
  overflow: "auto",
};

const rightPane: React.CSSProperties = {
  width: 300,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  gap: 12,
  overflow: "auto",
  padding: 12,
  background: "#161b22",
  borderRadius: 12,
  border: "1px solid #30363d",
};

const toolbar: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
};

const section: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  paddingTop: 8,
  borderTop: "1px solid #30363d",
};

const sectionTitle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "#c9d1d9",
};

const label: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 11,
  color: "#8b949e",
};

const input: React.CSSProperties = {
  background: "#0d1117",
  border: "1px solid #30363d",
  color: "#e6edf3",
  borderRadius: 8,
  padding: "7px 10px",
  fontSize: 13,
};

const btnPrimary: React.CSSProperties = {
  background: "#f0883e",
  border: "none",
  color: "#0d1117",
  fontWeight: 700,
  borderRadius: 8,
  padding: "10px 14px",
  cursor: "pointer",
};

const btnGhost: React.CSSProperties = {
  background: "#21262d",
  border: "1px solid #30363d",
  color: "#e6edf3",
  borderRadius: 8,
  padding: "8px 12px",
  cursor: "pointer",
  fontSize: 12,
};

const chip: React.CSSProperties = {
  ...btnGhost,
  padding: "4px 8px",
  fontSize: 11,
};

const fieldRowIdle: React.CSSProperties = {
  border: "1px solid #30363d",
  borderRadius: 8,
  background: "#0d1117",
};

const fieldRowActive: React.CSSProperties = {
  ...fieldRowIdle,
  borderColor: "#f0883e",
  background: "rgba(240,136,62,0.08)",
};

const fieldRowActiveImage: React.CSSProperties = {
  ...fieldRowIdle,
  borderColor: "#58a6ff",
  background: "rgba(88,166,255,0.08)",
};

const fieldRowMain: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 2,
  padding: "6px 8px",
  width: "100%",
  color: "#e6edf3",
  cursor: "pointer",
  textAlign: "left",
  fontSize: 12,
};

const chipAvatar: React.CSSProperties = {
  ...chip,
  borderColor: "#58a6ff",
  color: "#58a6ff",
};

const warnBox: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  background: "rgba(240,136,62,0.12)",
  border: "1px solid #f0883e",
  color: "#f0883e",
  fontSize: 11,
  lineHeight: 1.5,
};
