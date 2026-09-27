/** 导出前等待并内联 <img>，避免 html-to-image 丢失底图/头像 */
async function waitForImage(img: HTMLImageElement): Promise<void> {
  if (img.complete && img.naturalWidth > 0) {
    await img.decode?.().catch(() => undefined);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`图片加载失败：${img.src}`));
  });
  await img.decode?.().catch(() => undefined);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function inlineOneImage(img: HTMLImageElement): Promise<(() => void) | null> {
  const original = img.currentSrc || img.src;
  if (!original || original.startsWith("data:")) {
    await waitForImage(img).catch(() => undefined);
    return null;
  }

  await waitForImage(img).catch(() => undefined);

  try {
    const res = await fetch(original);
    if (!res.ok) throw new Error(String(res.status));
    const dataUrl = await blobToDataUrl(await res.blob());
    img.src = dataUrl;
    return () => {
      img.src = original;
    };
  } catch {
    try {
      if (img.naturalWidth <= 0) return null;
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);
      img.src = canvas.toDataURL("image/png");
      return () => {
        img.src = original;
      };
    } catch {
      return null;
    }
  }
}

/** 将节点内图片转为 data URL，返回恢复函数 */
export async function prepareExportImages(root: HTMLElement): Promise<() => void> {
  const images = Array.from(root.querySelectorAll("img"));
  const restores: Array<() => void> = [];

  for (const img of images) {
    const restore = await inlineOneImage(img);
    if (restore) restores.push(restore);
  }

  return () => {
    for (const restore of restores) restore();
  };
}
