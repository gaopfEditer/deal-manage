import type { CardTemplate, Exchange, TextField } from "./types";

const DEFAULT_FONT =
  '"PingFang SC", "SF Pro Text", "Helvetica Neue", sans-serif';
const FONT_BOLD =
  '"Inter", "PingFang SC", "DIN Alternate", "Helvetica Neue", sans-serif';

type PriceLayout = {
  entry: Pick<TextField, "x" | "y" | "fontSize" | "fontWeight" | "color" | "align" | "fontFamily">;
  exit: Pick<TextField, "x" | "y" | "fontSize" | "fontWeight" | "color" | "align" | "fontFamily">;
  labelFontSize: number;
  labelColor: string;
  labelGap: number;
};

/** 各交易所价格区默认布局（标签由 entryLabel/exitLabel 自动渲染文案） */
const PRICE_LAYOUT: Record<Exchange, PriceLayout> = {
  okx: {
    entry: {
      x: 51,
      y: 743,
      fontSize: 24,
      fontWeight: 700,
      color: "#FFFFFF",
      align: "left",
      fontFamily: FONT_BOLD,
    },
    exit: {
      x: 490,
      y: 743,
      fontSize: 24,
      fontWeight: 700,
      color: "#FFFFFF",
      align: "left",
      fontFamily: FONT_BOLD,
    },
    labelFontSize: 15,
    labelColor: "#8A8A8A",
    labelGap: 23,
  },
  gate: {
    entry: {
      x: 48,
      y: 520,
      fontSize: 16,
      fontWeight: 500,
      color: "#FFFFFF",
      align: "left",
      fontFamily: DEFAULT_FONT,
    },
    exit: {
      x: 48,
      y: 568,
      fontSize: 16,
      fontWeight: 500,
      color: "#FFFFFF",
      align: "left",
      fontFamily: DEFAULT_FONT,
    },
    labelFontSize: 14,
    labelColor: "#8b949e",
    labelGap: 24,
  },
  binance: {
    entry: {
      x: 48,
      y: 520,
      fontSize: 16,
      fontWeight: 500,
      color: "#FFFFFF",
      align: "left",
      fontFamily: DEFAULT_FONT,
    },
    exit: {
      x: 48,
      y: 568,
      fontSize: 16,
      fontWeight: 500,
      color: "#FFFFFF",
      align: "left",
      fontFamily: DEFAULT_FONT,
    },
    labelFontSize: 14,
    labelColor: "#8b949e",
    labelGap: 24,
  },
  bitget: {
    entry: {
      x: 48,
      y: 520,
      fontSize: 16,
      fontWeight: 500,
      color: "#FFFFFF",
      align: "left",
      fontFamily: DEFAULT_FONT,
    },
    exit: {
      x: 48,
      y: 568,
      fontSize: 16,
      fontWeight: 500,
      color: "#FFFFFF",
      align: "left",
      fontFamily: DEFAULT_FONT,
    },
    labelFontSize: 14,
    labelColor: "#8b949e",
    labelGap: 24,
  },
};

function makeLabel(
  id: "entryLabel" | "exitLabel",
  anchor: TextField,
  layout: PriceLayout
): TextField {
  return {
    key: `${anchor.key ?? "f"}_lbl`,
    id,
    x: anchor.x,
    y: anchor.y - layout.labelGap,
    fontSize: layout.labelFontSize,
    fontWeight: 400,
    color: layout.labelColor,
    align: anchor.align,
    fontFamily: anchor.fontFamily ?? DEFAULT_FONT,
  };
}

function makeValue(
  id: "entry" | "exit",
  preset: PriceLayout["entry"],
  keyPrefix: Exchange
): TextField {
  return {
    key: `${keyPrefix}_${id}`,
    id,
    ...preset,
  };
}

/** 自动补齐开仓/平仓价格标签与数值字段，无需手动添加 */
export function ensurePriceLabelFields(template: CardTemplate): CardTemplate {
  const layout = PRICE_LAYOUT[template.exchange];
  const fields = [...template.fields];

  let entry = fields.find((f) => f.id === "entry");
  let exit = fields.find((f) => f.id === "exit");
  const hasEntryLabel = fields.some((f) => f.id === "entryLabel");
  const hasExitLabel = fields.some((f) => f.id === "exitLabel");

  const toAdd: TextField[] = [];

  if (!entry) {
    entry = makeValue("entry", layout.entry, template.exchange);
    toAdd.push(entry);
  }
  if (!exit) {
    exit = makeValue("exit", layout.exit, template.exchange);
    toAdd.push(exit);
  }
  if (!hasEntryLabel && entry) {
    toAdd.push({
      ...makeLabel("entryLabel", entry, layout),
      key: `${template.exchange}_entry_lbl`,
    });
  }
  if (!hasExitLabel && exit) {
    toAdd.push({
      ...makeLabel("exitLabel", exit, layout),
      key: `${template.exchange}_exit_lbl`,
    });
  }

  if (toAdd.length === 0) return template;

  const insertAt = fields.findIndex((f) => f.id === "pnlPct");
  const idx = insertAt >= 0 ? insertAt + 1 : fields.length;
  fields.splice(idx, 0, ...toAdd);

  return { ...template, fields };
}
