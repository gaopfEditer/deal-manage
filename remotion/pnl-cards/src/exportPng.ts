import { toPng } from "html-to-image";

export async function exportCardPng(
  node: HTMLElement,
  filename: string
): Promise<void> {
  const dataUrl = await toPng(node, {
    pixelRatio: 2,
    cacheBust: true,
    skipFonts: false,
  });
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename.endsWith(".png") ? filename : `${filename}.png`;
  a.click();
}
