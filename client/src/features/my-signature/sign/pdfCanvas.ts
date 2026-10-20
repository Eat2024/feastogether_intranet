// 以 canvas 繪製 PDF 頁面的共用設定與工具（已簽署副本、簽到表共用）

// A4，150 dpi
export const W = 1240;
export const H = 1754;
// 與網頁預覽相同的比例（預覽頁寬 460px）
export const S = W / 460;
export const A4_PT = { w: 595.28, h: 841.89 };

export const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
