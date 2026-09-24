import React from "react";
import {
  snapPosition,
  type Bounds,
  type GuideLine,
} from "../editor/alignmentGuides";
import { DEFAULT_FONT, resolveImageSrc } from "../fieldUtils";
import { computePnl, resolveFieldColor, resolveFieldText } from "../formatField";
import type { CardTemplate, EditorSelection, TradeInput } from "../types";

type Props = {
  template: CardTemplate;
  trade: TradeInput;
  cardId?: string;
  selection?: EditorSelection | null;
  onSelect?: (sel: EditorSelection | null) => void;
  onMoveField?: (key: string, x: number, y: number) => void;
  onMoveImage?: (key: string, x: number, y: number) => void;
  onDragPosition?: (pos: { x: number; y: number } | null) => void;
  editable?: boolean;
};

export const CardPreview: React.FC<Props> = ({
  template,
  trade,
  cardId = "card",
  selection = null,
  onSelect,
  onMoveField,
  onMoveImage,
  onDragPosition,
  editable = false,
}) => {
  const pnlPct = computePnl(trade);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const [guides, setGuides] = React.useState<GuideLine[]>([]);
  const dragRef = React.useRef<{
    kind: "field" | "image";
    key: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    offsetLeft: number;
    offsetTop: number;
    width: number;
    height: number;
    others: Bounds[];
  } | null>(null);

  const measureLayerBounds = (layerEl: HTMLElement, cardRect: DOMRect): Bounds => {
    const r = layerEl.getBoundingClientRect();
    return {
      left: r.left - cardRect.left,
      top: r.top - cardRect.top,
      width: r.width,
      height: r.height,
    };
  };

  const measureOtherLayers = (excludeKey: string): Bounds[] => {
    const card = cardRef.current;
    if (!card) return [];
    const cardRect = card.getBoundingClientRect();
    const nodes = card.querySelectorAll<HTMLElement>("[data-editor-layer]");
    const result: Bounds[] = [];
    nodes.forEach((node) => {
      if (node.dataset.editorLayer === excludeKey) return;
      result.push(measureLayerBounds(node, cardRect));
    });
    return result;
  };

  const startDrag = (
    e: React.PointerEvent,
    kind: "field" | "image",
    key: string,
    x: number,
    y: number
  ) => {
    if (!editable) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect?.({ kind, key });

    const card = cardRef.current;
    const layerEl = e.currentTarget as HTMLElement;
    let offsetLeft = 0;
    let offsetTop = 0;
    let width = layerEl.offsetWidth;
    let height = layerEl.offsetHeight;
    if (card) {
      const cardRect = card.getBoundingClientRect();
      const bounds = measureLayerBounds(layerEl, cardRect);
      offsetLeft = bounds.left - x;
      offsetTop = bounds.top - y;
      width = bounds.width;
      height = bounds.height;
    }

    dragRef.current = {
      kind,
      key,
      startX: e.clientX,
      startY: e.clientY,
      originX: x,
      originY: y,
      offsetLeft,
      offsetTop,
      width,
      height,
      others: measureOtherLayers(key),
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const rawX = drag.originX + (e.clientX - drag.startX);
    const rawY = drag.originY + (e.clientY - drag.startY);
    const snapped = snapPosition(
      rawX,
      rawY,
      drag.offsetLeft,
      drag.offsetTop,
      drag.width,
      drag.height,
      drag.others,
      { width: template.width, height: template.height }
    );
    if (drag.kind === "field") onMoveField?.(drag.key, snapped.x, snapped.y);
    else onMoveImage?.(drag.key, snapped.x, snapped.y);
    onDragPosition?.({ x: snapped.x, y: snapped.y });
    setGuides(snapped.guides);
  };

  const onPointerUp = () => {
    dragRef.current = null;
    setGuides([]);
    onDragPosition?.(null);
  };

  const [natural, setNatural] = React.useState<{ w: number; h: number } | null>(null);

  React.useEffect(() => {
    setNatural(null);
  }, [template.bg]);

  const imgW = template.bgWidth ?? natural?.w ?? template.width;
  const imgH = template.bgHeight ?? natural?.h ?? template.height;
  const images = template.images ?? [];

  const isSelected = (kind: EditorSelection["kind"], key: string) =>
    selection?.kind === kind && selection.key === key;

  return (
    <div
      style={{
        position: "relative",
        width: template.width,
        height: template.height,
        flexShrink: 0,
        boxShadow: editable ? "0 0 0 1px #30363d" : undefined,
      }}
    >
      <div
        ref={cardRef}
        id={cardId}
        style={{
          position: "relative",
          width: template.width,
          height: template.height,
          overflow: "hidden",
          background: "#000000",
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onClick={() => editable && onSelect?.(null)}
      >
        <img
          src={template.bg}
          alt=""
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              setNatural({ w: img.naturalWidth, h: img.naturalHeight });
            }
          }}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: imgW,
            height: imgH,
            maxWidth: "none",
            maxHeight: "none",
            objectFit: "none",
            objectPosition: "0 0",
            userSelect: "none",
            pointerEvents: "none",
          }}
        />
        {template.fields.map((field) => {
          const text = resolveFieldText(field, trade, pnlPct);
          if (!text && !editable) return null;
          const color = resolveFieldColor(
            field,
            pnlPct,
            template.pnlUpColor,
            template.pnlDownColor
          );
          const selected = isSelected("field", field.key);
          const transform =
            field.align === "center"
              ? "translateX(-50%)"
              : field.align === "right"
                ? "translateX(-100%)"
                : undefined;

          return (
            <div
              key={field.key}
              data-editor-layer={field.key}
              onPointerDown={(e) => startDrag(e, "field", field.key, field.x, field.y)}
              onClick={(e) => {
                e.stopPropagation();
                onSelect?.({ kind: "field", key: field.key });
              }}
              style={{
                position: "absolute",
                left: field.x,
                top: field.y,
                transform,
                zIndex: 2,
                fontSize: field.fontSize,
                fontWeight: field.fontWeight,
                fontFamily: field.fontFamily ?? DEFAULT_FONT,
                letterSpacing: field.letterSpacing,
                color,
                textAlign: field.align,
                whiteSpace: "pre",
                lineHeight: 1.2,
                cursor: editable ? "move" : "default",
                outline: selected && editable ? "1px dashed #f0883e" : undefined,
                outlineOffset: selected && editable ? 2 : undefined,
                userSelect: "none",
              }}
            >
              {text || (editable ? `[${field.id}]` : "")}
            </div>
          );
        })}
        {images.map((layer) => {
          const src = resolveImageSrc(layer, trade.avatarUrl);
          const selected = isSelected("image", layer.key);
          const radius =
            (layer.borderRadius ?? 9999) >= 9999
              ? "50%"
              : `${layer.borderRadius ?? 0}px`;

          return (
            <div
              key={layer.key}
              data-editor-layer={layer.key}
              onPointerDown={(e) => startDrag(e, "image", layer.key, layer.x, layer.y)}
              onClick={(e) => {
                e.stopPropagation();
                onSelect?.({ kind: "image", key: layer.key });
              }}
              style={{
                position: "absolute",
                left: layer.x,
                top: layer.y,
                width: layer.width,
                height: layer.height,
                zIndex: 3,
                cursor: editable ? "move" : "default",
                outline: selected && editable ? "1px dashed #58a6ff" : undefined,
                borderRadius: radius,
                overflow: "hidden",
                background: src ? undefined : "rgba(88,166,255,0.15)",
                boxSizing: "border-box",
              }}
            >
              {src ? (
                <img
                  src={src}
                  alt=""
                  draggable={false}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                />
              ) : editable ? (
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#58a6ff",
                    fontSize: 11,
                    userSelect: "none",
                  }}
                >
                  头像
                </div>
              ) : null}
            </div>
          );
        })}
        {editable && guides.length > 0
          ? guides.map((g, i) =>
              g.orientation === "vertical" ? (
                <div
                  key={`v-${g.x}-${i}`}
                  style={{
                    position: "absolute",
                    left: g.x,
                    top: 0,
                    width: 1,
                    height: "100%",
                    background: "#ff4d8d",
                    boxShadow: "0 0 0 0.5px rgba(255,77,141,0.5)",
                    pointerEvents: "none",
                    zIndex: 20,
                  }}
                />
              ) : (
                <div
                  key={`h-${g.y}-${i}`}
                  style={{
                    position: "absolute",
                    left: 0,
                    top: g.y,
                    width: "100%",
                    height: 1,
                    background: "#ff4d8d",
                    boxShadow: "0 0 0 0.5px rgba(255,77,141,0.5)",
                    pointerEvents: "none",
                    zIndex: 20,
                  }}
                />
              )
            )
          : null}
      </div>
    </div>
  );
};
