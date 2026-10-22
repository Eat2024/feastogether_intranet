// 在瀏覽器端產生簽到表（原型，mock store）的 PDF：個人簽到副本與整份簽到表。
// 後端文件的已簽署副本由後端產生，不在瀏覽器端合成。
// TODO: 後端完成簽到表後改由後端產生，避免在瀏覽器端產生。
import type { SheetRow } from '@/features/forms/sheet/rules';
import type { EFormDoc, Signer } from '@/features/forms/types';
import { buildSheetPdf } from './sheetPdf';

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
 * 下載某位簽署人的簽到表副本（只含本人那一列）。
 * fileName 未指定時為「文件編號_文件名稱_已簽署.pdf」；有 password 時以 AES-256 加密，開啟檔案需輸入密碼。
 */
export async function downloadSignedCopy(
  form: EFormDoc,
  me: Signer,
  opts: { fileName?: string; password?: string } = {},
) {
  const rowNo = me.rowNo ?? form.signers.find((s) => s.id === me.id)?.rowNo ?? 1;
  const bytes = await buildSheetPdf(form, [{ no: rowNo, signer: me }]);
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
