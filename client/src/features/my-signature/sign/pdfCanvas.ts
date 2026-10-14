// 以 canvas 繪製 PDF 頁面的共用設定與工具（已簽署副本、簽到表共用）
import { WATERMARK_TEXT } from '@/features/forms/options';
import { color } from '@/theme/tokens';

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

/** 浮水印：斜向重複鋪滿整頁，淡灰色不遮蔽內容 */
export function drawWatermark(ctx: CanvasRenderingContext2D, font: string) {
  ctx.save();
  ctx.font = `500 ${16 * S}px ${font}`;
  ctx.fillStyle = color.textPlaceholder;
  ctx.globalAlpha = 0.18;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 依畫布實際尺寸鋪滿（非 A4 的原始文件頁面也適用）
  const { width, height } = ctx.canvas;
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-Math.PI / 6);
  const stepX = 260 * S;
  const stepY = 110 * S;
  // 旋轉後需涵蓋整頁對角線範圍
  const span = Math.hypot(width, height) / 2;
  for (let y = -span; y <= span; y += stepY) {
    // 每一列錯開半格，避免排成直行
    const offset = (Math.round(y / stepY) % 2) * (stepX / 2);
    for (let x = -span; x <= span; x += stepX) ctx.fillText(WATERMARK_TEXT, x + offset, y);
  }
  ctx.restore();
}
