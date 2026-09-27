import { toPng } from "html-to-image";
import { prepareExportImages } from "./prepareExportImages";

export async function exportCardPng(
  node: HTMLElement,
  filename: string
): Promise<void> {
  const restoreImages = await prepareExportImages(node);
  try {
    const dataUrl = await toPng(node, {
      pixelRatio: 2,
      cacheBust: false,
      skipFonts: false,
      backgroundColor: "#000000",
    });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename.endsWith(".png") ? filename : `${filename}.png`;
    a.click();
  } finally {
    restoreImages();
  }
}
