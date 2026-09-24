/** 读取底图原始像素尺寸 */
export function probeBgSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    };
    img.onerror = () => reject(new Error(`无法加载底图：${src}`));
    img.src = src;
  });
}
