// 在瀏覽器端產生「我的已簽署副本」PDF（示意用）。
// 尚無後端與原始 PDF 檔：每頁以示意版面繪製，並把本人的手寫簽名與日期疊在指定位置。
// 串接後端後，應改由後端在原始 PDF 上合成並提供下載。
// 以 canvas 繪製每頁再嵌入 PDF，可沿用網頁字型顯示中文（pdf-lib 內建字型不支援中文）。
import { FIELD_H_PCT, FIELD_W_PCT, getSignLayout } from '@/features/forms/signLayout';
import type { EFormDoc, Signer } from '@/features/forms/types';
import { color } from '@/theme/tokens';
import { signatureVerifyUrl } from '@/lib/signatureQr';
import { PDFDocument } from 'pdf-lib';
import QRCode from 'qrcode';

// A4，150 dpi
const W = 1240;
const H = 1754;
// 與網頁預覽相同的比例（預覽頁寬 460px）
const S = W / 460;
const A4_PT = { w: 595.28, h: 841.89 };

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

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

/** 產生本人已簽署副本的 PDF */
export async function buildSignedCopyPdf(form: EFormDoc, me: Signer): Promise<Uint8Array> {
  const layout = getSignLayout(form);
  if (!layout) throw new Error('此文件沒有可簽署的內容');
  const font = getComputedStyle(document.body).fontFamily;
  const signedDate = (me.signedAt ?? '').slice(0, 10);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.textBaseline = 'alphabetic';

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${form.name}（已簽署）`);

  for (let page = 1; page <= layout.pageCount; page++) {
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
      const w = (FIELD_W_PCT / 100) * W;
      const h = (FIELD_H_PCT / 100) * H;
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
          const qr = await loadImage(
            await QRCode.toDataURL(signatureVerifyUrl(sigId, window.location.origin), {
              margin: 0,
              errorCorrectionLevel: 'M',
              width: Math.round(qrSize * 2),
            }),
          );
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

    const png = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
    const image = await pdf.embedPng(await png.arrayBuffer());
    pdf.addPage([A4_PT.w, A4_PT.h]).drawImage(image, { x: 0, y: 0, width: A4_PT.w, height: A4_PT.h });
  }

  return pdf.save();
}

/**
 * 觸發瀏覽器下載。
 * fileName 未指定時為「文件編號_文件名稱_已簽署.pdf」；有 password 時以 AES-256 加密，開啟檔案需輸入密碼。
 */
export async function downloadSignedCopy(
  form: EFormDoc,
  me: Signer,
  opts: { fileName?: string; password?: string } = {},
) {
  const { fileName, password } = opts;
  let bytes = await buildSignedCopyPdf(form, me);
  if (password) {
    // AES-256 需要 Web Crypto（crypto.subtle），只有 HTTPS 或 localhost 才有
    if (!window.isSecureContext) throw new Error('INSECURE_CONTEXT');
    const { encryptPDF } = await import('@pdfsmaller/pdf-encrypt');
    bytes = await encryptPDF(bytes, password);
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName ?? `${form.docNumber ?? form.id}_${form.name}_已簽署.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
