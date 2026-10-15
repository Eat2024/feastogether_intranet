// 我的電子簽：簽署任務後端 API（僅供 Next.js server 端）。
import { EsignApiError, esignFetch, esignRequest, redirectToLogin } from '@/lib/api/esign';
import { PDFDocument } from 'pdf-lib';
import type { SigningTask } from './taskForm';

export { toMySignTask, type SigningTask } from './taskForm';

/** 指派給本人的簽署任務（不含草稿） */
export function listSigningTasks(redirectOnUnauthorized = true) {
  return esignRequest<SigningTask[]>('/esign/signing-tasks', { redirectOnUnauthorized });
}

/** 以 signerPublicId 取得本人的簽署任務；不是本人的任務回傳 undefined */
export async function getSigningTask(signerPublicId: string) {
  return (await listSigningTasks()).find((task) => task.signerPublicId === signerPublicId);
}

/** 原始 PDF 的頁數（任務資料不含頁數，以原始檔計算） */
export async function sourcePageCount(signerPublicId: string): Promise<number> {
  const res = await esignFetch(`/esign/signing-tasks/${encodeURIComponent(signerPublicId)}/source-file`);
  if (res.status === 401) await redirectToLogin();
  if (!res.ok) throw new EsignApiError(res.status, '無法讀取文件');
  const doc = await PDFDocument.load(new Uint8Array(await res.arrayBuffer()), { updateMetadata: false });
  return doc.getPageCount();
}

/** 開啟簽署任務：記錄開啟並由後端再次確認仍可簽署 */
export function openSigningTask(signerPublicId: string) {
  return esignRequest<SigningTask>(`/esign/signing-tasks/${encodeURIComponent(signerPublicId)}`, {
    method: 'POST',
  });
}

/** 送出本人所有簽名欄位的手寫簽名；日期欄位由後端依簽署時間自動帶入 */
export function submitSignatures(
  signerPublicId: string,
  body: {
    requestId: string;
    consentVersion: string;
    accepted: true;
    signatures: { fieldId: string; pngDataUrl: string }[];
  },
) {
  return esignRequest<{ signerPublicId: string; signedAt: string; documentStatus: string }>(
    `/esign/signing-tasks/${encodeURIComponent(signerPublicId)}/signatures`,
    { method: 'POST', json: body },
  );
}
