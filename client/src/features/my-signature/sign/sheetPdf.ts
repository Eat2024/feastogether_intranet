// 在瀏覽器端產生簽到表 PDF（示意用）：依公司簽到表版面繪製，每頁固定列數、每頁重複表頭，
// 簽到格放手寫簽名，頁尾放整份文件的追蹤 QR code（個別簽名的識別碼請見 Excel 匯出）。
import { formOptions } from '@/features/forms/options';
import { SHEET_ROWS_PER_PAGE, SHEET_SIGN_FIELD_ID, type SheetRow } from '@/features/forms/sheet/rules';
import type { EFormDoc } from '@/features/forms/types';
import { documentVerifyUrl } from '@/lib/signatureQr';
import { color } from '@/theme/tokens';
import { PDFDocument } from 'pdf-lib';
import QRCode from 'qrcode';
import { A4_PT, drawWatermark, H, loadImage, W } from './pdfCanvas';

const MARGIN_X = 90;
const LINE = 2;
const HEADER_ROW_H = 64;
const FOOTER_H = 170;
// 欄位寬度比例：序號、單位、職稱、姓名、簽到、簽到時間、備註
const COL_RATIOS = [0.07, 0.17, 0.15, 0.13, 0.18, 0.14, 0.16];
const COL_LABELS = ['序號', '單位', '職稱', '姓名', '簽到', '簽到時間', '備註'];

/** 超出寬度時以「…」截斷 */
function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  if (ctx.measureText(text).width <= maxW) return text;
  const chars = Array.from(text);
  while (chars.length && ctx.measureText(`${chars.join('')}…`).width > maxW) chars.pop();
  return `${chars.join('')}…`;
}

export async function buildSheetPdf(
  form: EFormDoc,
  rows: SheetRow[],
  opts: {
    /** 應到／實到人數；省略時不顯示 */
    attendance?: { expected: number; actual: number };
    /** 最後一頁補滿空白列（整份簽到表用；個人副本不補） */
    padLastPage?: boolean;
  } = {},
): Promise<Uint8Array> {
  const sheet = form.sheet;
  if (!sheet) throw new Error('此文件不是簽到表');
  const font = getComputedStyle(document.body).fontFamily;
  const { watermark } = formOptions(form);
  const fields = opts.attendance
    ? [...sheet.fields, { label: '出席人數', value: `應到 ${opts.attendance.expected} 人；實到 ${opts.attendance.actual} 人` }]
    : sheet.fields;

  const pageCount = Math.max(1, Math.ceil(rows.length / SHEET_ROWS_PER_PAGE));
  const qr = await loadImage(
    await QRCode.toDataURL(documentVerifyUrl(form.id, window.location.origin), { margin: 0, width: 240 }),
  );
  const signatures = new Map<string, HTMLImageElement>();
  for (const r of rows) {
    const sig = r.signer?.signatures?.[SHEET_SIGN_FIELD_ID];
    if (r.signer && sig) signatures.set(r.signer.id, await loadImage(sig));
  }

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const tableW = W - MARGIN_X * 2;
  const colX: number[] = [];
  COL_RATIOS.reduce((x, r) => (colX.push(x), x + r * tableW), MARGIN_X);
  const colW = COL_RATIOS.map((r) => r * tableW);

  const text = (t: string, x: number, y: number, size: number, opt: { weight?: number; fill?: string; align?: CanvasTextAlign; maxW?: number } = {}) => {
    ctx.font = `${opt.weight ?? 400} ${size}px ${font}`;
    ctx.fillStyle = opt.fill ?? color.textDefault;
    ctx.textAlign = opt.align ?? 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(opt.maxW ? fit(ctx, t, opt.maxW) : t, x, y);
  };
  /**
   * 在格子內置中顯示文字：先縮小字級，仍放不下時折成兩行（優先在空白處斷行），最後才截斷。
   */
  const cellText = (t: string, cx: number, cy: number, maxW: number, maxH: number, base = 24) => {
    ctx.fillStyle = color.textDefault;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const setSize = (size: number) => (ctx.font = `400 ${size}px ${font}`);
    for (let size = base; size >= 18; size -= 2) {
      setSize(size);
      if (ctx.measureText(t).width <= maxW) return void ctx.fillText(t, cx, cy);
    }
    const size = Math.max(14, Math.min(20, Math.floor(maxH / 2.8)));
    setSize(size);
    const chars = Array.from(t);
    // 找第一行能放下的最多字數；有空白時在最後一個空白處斷行（例如日期與時間）
    let cut = chars.length;
    while (cut > 1 && ctx.measureText(chars.slice(0, cut).join('')).width > maxW) cut--;
    const space = chars.slice(0, cut).lastIndexOf(' ');
    if (space > 0) cut = space + 1;
    const first = chars.slice(0, cut).join('').trim();
    const second = fit(ctx, chars.slice(cut).join('').trim(), maxW);
    ctx.fillText(first, cx, cy - size * 0.55);
    ctx.fillText(second, cx, cy + size * 0.55);
  };
  const rect = (x: number, y: number, w: number, h: number, fill?: string) => {
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, w, h);
    }
    ctx.strokeStyle = color.textDefault;
    ctx.lineWidth = LINE;
    ctx.strokeRect(x, y, w, h);
  };

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${form.name}（簽到表）`);

  for (let page = 0; page < pageCount; page++) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);

    // 公司名稱、標題、表單編號
    text('饗賓餐旅事業', MARGIN_X, 90, 30, { weight: 500, fill: color.textSubtitle });
    text(sheet.title, W / 2, 200, 40, { weight: 700, align: 'center', fill: color.textHeadline });
    if (sheet.formCode) text(sheet.formCode, W - MARGIN_X, 200, 26, { align: 'right' });

    // 表頭欄位：兩欄排列
    let y = 250;
    const half = tableW / 2;
    const labelW = tableW * 0.14;
    for (let i = 0; i < fields.length; i += 2) {
      for (let k = 0; k < 2; k++) {
        const f = fields[i + k];
        const x = MARGIN_X + k * half;
        rect(x, y, labelW, HEADER_ROW_H, color.formBorder);
        rect(x + labelW, y, half - labelW, HEADER_ROW_H);
        if (f) {
          text(f.label, x + labelW / 2, y + HEADER_ROW_H / 2, 26, { weight: 500, align: 'center', maxW: labelW - 12 });
          text(f.value, x + labelW + 14, y + HEADER_ROW_H / 2, 26, { maxW: half - labelW - 28 });
        }
      }
      y += HEADER_ROW_H;
    }

    // 「受訓人員」與欄位名稱
    rect(MARGIN_X, y, tableW, HEADER_ROW_H, color.formBorder);
    text('受　訓　人　員', W / 2, y + HEADER_ROW_H / 2, 28, { weight: 500, align: 'center' });
    y += HEADER_ROW_H;
    COL_LABELS.forEach((label, c) => {
      rect(colX[c], y, colW[c], HEADER_ROW_H);
      text(label, colX[c] + colW[c] / 2, y + HEADER_ROW_H / 2, 26, { weight: 500, align: 'center' });
    });
    y += HEADER_ROW_H;

    // 資料列：列高依剩餘空間平均分配
    const rowH = Math.min(80, (H - FOOTER_H - y) / SHEET_ROWS_PER_PAGE);
    const pageRows = rows.slice(page * SHEET_ROWS_PER_PAGE, (page + 1) * SHEET_ROWS_PER_PAGE);
    const lastNo = rows.at(-1)?.no ?? 0;
    const padded =
      opts.padLastPage && page === pageCount - 1
        ? [
            ...pageRows,
            ...Array.from({ length: SHEET_ROWS_PER_PAGE - pageRows.length }, (_, i) => ({ no: lastNo + i + 1, signer: null })),
          ]
        : pageRows;
    for (const { no, signer } of padded) {
      const cy = y + rowH / 2;
      COL_LABELS.forEach((_, c) => rect(colX[c], y, colW[c], rowH));
      text(String(no), colX[0] + 12, cy, 26);
      if (signer) {
        const center = (c: number, t: string | undefined) =>
          t && cellText(t, colX[c] + colW[c] / 2, cy, colW[c] - 16, rowH);
        center(1, signer.unit);
        center(2, signer.title);
        center(3, signer.name);
        const img = signatures.get(signer.id);
        if (img) {
          // 等比縮放置中（contain）
          const maxW = colW[4] - 16;
          const maxH = rowH - 10;
          const scale = Math.min(maxW / img.width, maxH / img.height);
          ctx.drawImage(img, colX[4] + (colW[4] - img.width * scale) / 2, cy - (img.height * scale) / 2, img.width * scale, img.height * scale);
        } else if (signer.status === 'signed') {
          center(4, '已簽到');
        }
        if (signer.status === 'signed') center(5, signer.signedAt);
        center(6, signer.remark);
      }
      y += rowH;
    }

    // 頁尾：文件資訊、頁碼與整份文件的追蹤 QR code
    const qrSize = 110;
    const footerY = H - FOOTER_H + 40;
    ctx.drawImage(qr, W - MARGIN_X - qrSize, footerY, qrSize, qrSize);
    text(`${form.docNumber ?? ''}　${form.name}`, MARGIN_X, footerY + 30, 22, { fill: color.textSubtitle, maxW: tableW - qrSize - 40 });
    text(`第 ${page + 1} / ${pageCount} 頁　此為系統產生之簽到表`, MARGIN_X, footerY + 70, 22, { fill: color.textPlaceholder });

    if (watermark) drawWatermark(ctx, font);

    const png = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
    const image = await pdf.embedPng(await png.arrayBuffer());
    pdf.addPage([A4_PT.w, A4_PT.h]).drawImage(image, { x: 0, y: 0, width: A4_PT.w, height: A4_PT.h });
  }

  return pdf.save();
}
