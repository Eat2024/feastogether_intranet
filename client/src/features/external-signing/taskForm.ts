// 外部簽署任務轉成共用簽署元件（DocumentViewer、SignProgressPanel）需要的資料，以及送出簽名的內容
import type { ExternalSigningTask, SubmitExternalSignaturesBody } from '@/api/types';
import { fromFieldView } from '@/features/esign-documents/fields';
import { signFields, type SignLayout } from '@/features/forms/signLayout';

/**
 * 簽署版面：外部文件只有頁內欄位（沒有系統簽署確認頁），頁數取自原始 PDF。
 * 欄位 id 沿用後端欄位 id，送出時原樣帶回。
 */
export function toSignLayout(task: ExternalSigningTask, pageCount: number): SignLayout {
  return {
    pageCount,
    originalPages: pageCount,
    confirmPage: null,
    fields: task.fields.map((f) => fromFieldView(f, Number(f.id))),
  };
}

/** DocumentViewer 顯示用的文件資料；原始 PDF 由呼叫端讀取後另外傳入 */
export const toViewerForm = (task: ExternalSigningTask) => ({
  id: task.document.id,
  name: task.document.title,
  docNumber: null,
});

/**
 * 送出內容：每個簽名欄位一筆（日期由後端以簽署時間帶入）。
 * signerPublicId 為頁面所屬簽署人（ExternalSigning 已確認與網址相同），後端據此拒絕 cookie 已被其他邀請覆蓋的送出。
 */
export function toSubmission(
  task: ExternalSigningTask,
  layout: SignLayout,
  signatures: Record<number, string>,
  requestId: string,
): SubmitExternalSignaturesBody {
  return {
    signerPublicId: task.signerPublicId,
    requestId,
    consentVersion: task.consent.version,
    accepted: true,
    signatures: signFields(layout).map((f) => ({ fieldId: String(f.id), pngDataUrl: signatures[f.id] })),
  };
}

// 外部簽署人不一定在台灣：日期一律以台北時間顯示，與後端的簽署期限及寫入 PDF 的日期一致
const TAIPEI = { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' } as const;
const taipeiDateFormat = new Intl.DateTimeFormat('zh-TW', TAIPEI);
const taipeiDateTimeFormat = new Intl.DateTimeFormat('zh-TW', {
  ...TAIPEI,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** YYYY/MM/DD（台北時間） */
export const taipeiDate = (value: Date | string) => taipeiDateFormat.format(new Date(value));

/** YYYY/MM/DD HH:mm（台北時間） */
export const taipeiDateTime = (value: Date | string) => taipeiDateTimeFormat.format(new Date(value));
