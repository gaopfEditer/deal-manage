#!/usr/bin/env node
/** 生成四所空卡占位 PNG（750×1334），可替换为 Photopea 导出的正式底图 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public/backgrounds");

const cards = [
  { name: "okx", w: 1080, h: 1920, bg: [0, 0, 0], label: "OKX · 1080×1920" },
  { name: "gate", w: 750, h: 1334, bg: [15, 18, 28], label: "Gate · 空卡占位" },
  { name: "binance", w: 750, h: 1334, bg: [11, 14, 17], label: "Binance · 空卡占位" },
  { name: "bitget", w: 750, h: 1334, bg: [12, 16, 24], label: "Bitget · 空卡占位" },
];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function solidPng(width, height, rgb) {
  const row = Buffer.alloc(1 + width * 3);
  row[0] = 0;
  for (let x = 0; x < width; x++) {
    const o = 1 + x * 3;
    row[o] = rgb[0];
    row[o + 1] = rgb[1];
    row[o + 2] = rgb[2];
  }
  const raw = Buffer.alloc((1 + width * 3) * height);
  for (let y = 0; y < height; y++) row.copy(raw, y * row.length);
  const compressed = zlib.deflateSync(raw, { level: 9 });
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(OUT, { recursive: true });
for (const card of cards) {
  const w = card.w ?? 750;
  const h = card.h ?? 1334;
  const file = path.join(OUT, `${card.name}.png`);
  fs.writeFileSync(file, solidPng(w, h, card.bg));
  console.log(`wrote ${file} (${w}x${h}) · ${card.label}`);
}
