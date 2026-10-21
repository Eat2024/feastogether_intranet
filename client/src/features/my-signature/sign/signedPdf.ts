// 在瀏覽器端產生「已簽署副本」PDF：
// - 有原始檔：在原始 PDF 上合成本人的簽名、日期與追蹤 QR code（保留原文件的文字與向量內容）。
// - 舊資料沒有原始檔：每頁以示意版面繪製（canvas，可沿用網頁字型顯示中文；pdf-lib 內建字型不支援中文）。
// TODO: 串接後端後，改由後端合成並加上數位簽章，避免在瀏覽器端產生。
import { formOptions } from '@/features/forms/options';
import type { SheetRow } from '@/features/forms/sheet/rules';
import { A4_PT, drawWatermark, H, loadImage, S, W } from './pdfCanvas';
import { buildSheetPdf } from './sheetPdf';
import { fieldSize, getSignLayout, type SignLayout } from '@/features/forms/signLayout';
import type { EFormDoc, Signer } from '@/features/forms/types';
import { color } from '@/theme/tokens';
import { signatureVerifyUrl } from '@/lib/signatureQr';
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';


function drawPage(
  ctx: CanvasRenderingContext2D,
  font: string,
  opts: { form: EFormDoc; me: Signer; page: number; pageCount: number; originalPages: number; isConfirm: boolean },
) {
  const { form, me, page, pageCount, originalPages, isConfirm } = opts;
  const text = (t: string, x: number, y: number, size: number, weight = 400, fill: string = color.textDefault) => {
    ctx.font = `${weight} ${size * S}px ${font}`;
    ctx.fillStyle = fill;
    ctx.fillText(t, x, y);
  };
  const padX = 24 * S;
  let y = 32 * S + 13 * S;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  if (isConfirm) {
    ctx.textAlign = 'center';
    text('電子簽署確認書', W / 2, y + 4 * S, 16, 700, color.textHeadline);
    ctx.textAlign = 'left';
    y += 36 * S;
    for (const line of [`文件名稱：${form.name}`, `文件編號：${form.docNumber ?? '—'}`, `文件頁數：${originalPages} 頁`]) {
      text(line, padX, y, 12, 400, color.textSubtitle);
      y += 20 * S;
    }
    y += 24 * S;
    text('本人確認已閱讀並同意上述文件內容。', padX, y, 12);
    y += 44 * S;
    for (const line of [`簽署人：${me.name}`, `員工編號：${me.employeeNo}`]) {
      text(line, padX, y, 12, 400, color.textSubtitle);
      y += 20 * S;
    }
  } else {
    text(`第 ${page} 頁`, padX, y, 14, 500, color.textSubtitle);
    y += 20 * S;
    ctx.fillStyle = color.gray[100];
    for (const w of [40, 80, 60, 80, 40, 80, 60]) {
      ctx.fillRect(padX, y, ((W - padX * 2) * w) / 100, 7 * S);
      y += 15 * S;
    }
    if (page === originalPages) {
      y += 24 * S;
      for (const t of ['甲方', '乙方', '日期']) {
        text(`${t}：＿＿＿＿＿＿＿＿`, padX, y, 12, 400, color.textSubtitle);
        y += 28 * S;
      }
    }
  }

  // 頁尾：簽署資訊（供辨識是誰的副本）
  ctx.textAlign = 'center';
  text(
    `${form.docNumber ?? ''}　${me.name}（${me.employeeNo}）簽署於 ${me.signedAt ?? ''}　第 ${page} / ${pageCount} 頁`,
    W / 2,
    H - 36 * S,
    9,
    400,
    color.textSubtitle,
  );
  text('此為系統產生之示意副本', W / 2, H - 20 * S, 9, 400, color.textPlaceholder);
  ctx.textAlign = 'left';
}

/** 以 canvas 繪製一頁示意版面（含本人的簽名、日期與浮水印），回傳 PNG */
async function renderCanvasPage(
  form: EFormDoc,
  me: Signer,
  layout: SignLayout,
  page: number,
  font: string,
  watermark: boolean,
): Promise<ArrayBuffer> {
  const signedDate = (me.signedAt ?? '').slice(0, 10);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.textBaseline = 'alphabetic';
  drawPage(ctx, font, {
    form,
    me,
    page,
    pageCount: layout.pageCount,
    originalPages: layout.originalPages,
    isConfirm: page === layout.confirmPage,
  });

  for (const f of layout.fields.filter((x) => x.page === page)) {
    const x = (f.x / 100) * W;
    const y = (f.y / 100) * H;
    const size = fieldSize(f);
    const w = (size.w / 100) * W;
    const h = (size.h / 100) * H;
    if (f.type === 'date') {
      ctx.font = `400 ${12 * S}px ${font}`;
      ctx.fillStyle = color.textDefault;
      ctx.textAlign = 'center';
      ctx.fillText(signedDate, x + w / 2, y + h / 2 + 4 * S);
      ctx.textAlign = 'left';
      ctx.fillStyle = color.gray[400];
      ctx.fillRect(x, y + h - 1 * S, w, 1 * S);
      continue;
    }
    const sig = me.signatures?.[f.id];
    const sigId = me.signatureIds?.[f.id];
    if (sig) {
      // 有識別碼時，右下角留給追蹤 QR code（與畫面相同：高度為欄位的 72%）
      const qrSize = sigId ? h * 0.72 : 0;
      const gap = sigId ? 4 * S : 0;
      const sigW = w - qrSize - gap;
      const img = await loadImage(sig);
      // 等比縮放置中（contain）
      const scale = Math.min(sigW / img.width, h / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, x + (sigW - dw) / 2, y + (h - dh) / 2, dw, dh);
      if (sigId) {
        const qr = await loadImage(await qrDataUrl(sigId, Math.round(qrSize * 2)));
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(x + w - qrSize, y + h - qrSize, qrSize, qrSize);
        ctx.drawImage(qr, x + w - qrSize, y + h - qrSize, qrSize, qrSize);
      }
    } else {
      // 舊資料沒有簽名圖檔
      ctx.font = `400 ${11 * S}px ${font}`;
      ctx.fillStyle = color.textSubtitle;
      ctx.fillText('（已簽署）', x, y + h / 2);
    }
  }

  if (watermark) drawWatermark(ctx, font);
  const png = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
  return png.arrayBuffer();
}

const qrDataUrl = (sigId: string, width: number) =>
  QRCode.toDataURL(signatureVerifyUrl(sigId, window.location.origin), { margin: 0, errorCorrectionLevel: 'M', width });

/** 沒有原始檔（舊資料）：每頁以示意版面繪製 */
async function buildCanvasCopy(form: EFormDoc, me: Signer, layout: SignLayout, font: string, watermark: boolean) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${form.name}（已簽署）`);
  for (let page = 1; page <= layout.pageCount; page++) {
    const image = await pdf.embedPng(await renderCanvasPage(form, me, layout, page, font, watermark));
    pdf.addPage([A4_PT.w, A4_PT.h]).drawImage(image, { x: 0, y: 0, width: A4_PT.w, height: A4_PT.h });
  }
  return pdf.save();
}

// 編輯與簽署畫面把每頁以等比縮放置中放在 A4 框內，欄位位置是相對於這個 A4 框的百分比
const FRAME_H = 297 / 210;

/**
 * 一頁原始 PDF 的座標換算：把「A4 框的百分比」換成頁面上的實際位置，
 * 並處理頁面旋轉（/Rotate），讓畫上去的內容在閱讀方向上是正的。
 */
function pageMapper(page: PDFPage) {
  const box = page.getCropBox();
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const swap = rotation === 90 || rotation === 270;
  // 閱讀時看到的頁面寬高
  const viewW = swap ? box.height : box.width;
  const viewH = swap ? box.width : box.height;
  const scale = Math.min(1 / viewW, FRAME_H / viewH);
  const offsetX = (1 - viewW * scale) / 2;
  const offsetY = (FRAME_H - viewH * scale) / 2;

  /** 閱讀方向（左下為原點）的點 → PDF 使用者座標 */
  const toUser = (u: number, v: number) => {
    switch (rotation) {
      case 90:
        return { x: box.x + box.width - v, y: box.y + u };
      case 180:
        return { x: box.x + box.width - u, y: box.y + box.height - v };
      case 270:
        return { x: box.x + v, y: box.y + box.height - u };
      default:
        return { x: box.x + u, y: box.y + v };
    }
  };

  return {
    viewW,
    viewH,
    /** A4 框的百分比（左上為原點）→ 閱讀方向的頁面座標（左上為原點，單位 pt） */
    fromFrame(xPct: number, yPct: number, wPct: number, hPct: number) {
      return {
        x: (xPct / 100 - offsetX) / scale,
        y: ((yPct / 100) * FRAME_H - offsetY) / scale,
        w: wPct / 100 / scale,
        h: ((hPct / 100) * FRAME_H) / scale,
      };
    },
    /** 在閱讀方向的矩形（左上為原點）畫圖片，保持正向 */
    drawImage(image: PDFImage, r: { x: number; y: number; w: number; h: number }) {
      const { x, y } = toUser(r.x, viewH - r.y - r.h);
      page.drawImage(image, { x, y, width: r.w, height: r.h, rotate: degrees(rotation) });
    },
    drawRect(r: { x: number; y: number; w: number; h: number }) {
      const { x, y } = toUser(r.x, viewH - r.y - r.h);
      page.drawRectangle({ x, y, width: r.w, height: r.h, color: rgb(1, 1, 1), rotate: degrees(rotation) });
    },
    /** 在閱讀方向的點（左下為文字基線起點）寫文字 */
    drawText(text: string, u: number, baseline: number, size: number, font: PDFFont) {
      const { x, y } = toUser(u, viewH - baseline);
      page.drawText(text, { x, y, size, font, color: rgb(0.13, 0.13, 0.13), rotate: degrees(rotation) });
    },
  };
}

/** 有原始檔：在原始 PDF 上合成本人的簽名、日期與追蹤 QR code（需要時附加系統簽署確認頁） */
async function buildOriginalCopy(form: EFormDoc, me: Signer, layout: SignLayout, font: string, watermark: boolean) {
  const res = await fetch(`/files/forms/${encodeURIComponent(form.id)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`無法取得原始文件（${res.status}）`);
  const pdf = await PDFDocument.load(await res.arrayBuffer());
  pdf.setTitle(`${form.name}（已簽署）`);
  pdf.setSubject(`${form.docNumber ?? form.id}・簽署人 ${me.name}（${me.employeeNo || me.email || '—'}）簽署於 ${me.signedAt ?? ''}`);
  pdf.setProducer('饗賓電子簽署');
  // 日期只有數字與斜線，可用內建字型
  const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
  const signedDate = (me.signedAt ?? '').slice(0, 10);
  const pages = pdf.getPages();

  for (const f of layout.fields) {
    if (f.page > layout.originalPages) continue;
    const page = pages[f.page - 1];
    if (!page) continue;
    const map = pageMapper(page);
    const size = fieldSize(f);
    const r = map.fromFrame(f.x, f.y, size.w, size.h);

    if (f.type === 'date') {
      const fontSize = Math.min(12, r.h * 0.55);
      const textW = helvetica.widthOfTextAtSize(signedDate, fontSize);
      map.drawText(signedDate, r.x + (r.w - textW) / 2, r.y + r.h / 2 + fontSize * 0.35, fontSize, helvetica);
      continue;
    }
    const sig = me.signatures?.[f.id];
    const sigId = me.signatureIds?.[f.id];
    if (!sig) continue;
    // 簽名在左、追蹤 QR code 在右下角（與畫面相同：高度為欄位的 72%）
    const qrSize = sigId ? r.h * 0.72 : 0;
    const gap = sigId ? r.h * 0.08 : 0;
    const sigImage = await pdf.embedPng(sig);
    const sigW = r.w - qrSize - gap;
    const scale = Math.min(sigW / sigImage.width, r.h / sigImage.height);
    const dw = sigImage.width * scale;
    const dh = sigImage.height * scale;
    map.drawImage(sigImage, { x: r.x + (sigW - dw) / 2, y: r.y + (r.h - dh) / 2, w: dw, h: dh });
    if (sigId) {
      const qrRect = { x: r.x + r.w - qrSize, y: r.y + r.h - qrSize, w: qrSize, h: qrSize };
      map.drawRect(qrRect);
      map.drawImage(await pdf.embedPng(await qrDataUrl(sigId, 240)), qrRect);
    }
  }

  // 浮水印：依每頁閱讀方向的比例畫成透明圖片後覆蓋整頁
  if (watermark) {
    for (const page of pages) {
      const map = pageMapper(page);
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = Math.round((W * map.viewH) / map.viewW);
      drawWatermark(canvas.getContext('2d')!, font);
      const png = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
      map.drawImage(await pdf.embedPng(await png.arrayBuffer()), { x: 0, y: 0, w: map.viewW, h: map.viewH });
    }
  }

  // 系統簽署確認頁（公版 A4）附加在原文件最後
  if (layout.confirmPage) {
    const image = await pdf.embedPng(await renderCanvasPage(form, me, layout, layout.confirmPage, font, watermark));
    pdf.addPage([A4_PT.w, A4_PT.h]).drawImage(image, { x: 0, y: 0, width: A4_PT.w, height: A4_PT.h });
  }
  return pdf.save();
}

/**
 * 產生本人已簽署副本的 PDF。
 * 有原始檔時在原始 PDF 上合成簽名；舊資料沒有原始檔時改以示意版面繪製。
 */
export async function buildSignedCopyPdf(form: EFormDoc, me: Signer): Promise<Uint8Array> {
  const layout = getSignLayout(form);
  if (!layout) throw new Error('此文件沒有可簽署的內容');
  const font = getComputedStyle(document.body).fontFamily;
  const { watermark } = formOptions(form);
  return form.upload?.fileId
    ? buildOriginalCopy(form, me, layout, font, watermark)
    : buildCanvasCopy(form, me, layout, font, watermark);
}

/** 加密（選用）並觸發瀏覽器下載 */
async function savePdf(bytes: Uint8Array, fileName: string, password?: string) {
  if (password) {
    // AES-256 需要 Web Crypto（crypto.subtle），只有 HTTPS 或 localhost 才有
    if (!window.isSecureContext) throw new Error('INSECURE_CONTEXT');
    const { encryptPDF } = await import('@pdfsmaller/pdf-encrypt');
    bytes = await encryptPDF(bytes, password);
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 下載某位簽署人的已簽署副本。
 * 簽到表的個人副本只含本人那一列；fileName 未指定時為「文件編號_文件名稱_已簽署.pdf」；
 * 有 password 時以 AES-256 加密，開啟檔案需輸入密碼。
 */
export async function downloadSignedCopy(
  form: EFormDoc,
  me: Signer,
  opts: { fileName?: string; password?: string } = {},
) {
  const bytes =
    form.docType === 'sheet'
      ? await buildSheetPdf(form, [{ no: me.rowNo ?? form.signers.find((s) => s.id === me.id)?.rowNo ?? 1, signer: me }])
      : await buildSignedCopyPdf(form, me);
  await savePdf(bytes, opts.fileName ?? `${form.docNumber ?? form.id}_${form.name}_已簽署.pdf`, opts.password);
}

/** 下載整份簽到表（含所有人的簽到；最後一頁補滿空白格線，版面與紙本一致） */
export async function downloadSheet(
  form: EFormDoc,
  rows: SheetRow[],
  attendance: { expected: number; actual: number },
  fileName: string,
) {
  await savePdf(await buildSheetPdf(form, rows, { attendance, padLastPage: true }), fileName);
}
