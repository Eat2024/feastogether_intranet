import { redirectExpiredSession } from '@/features/auth/navigation';
// 電子簽後端 API（NestJS，經 next.config.ts 的 rewrite 同源代理 /api/*）。
// PDF 上限 20MB，超過 Server Action 的 body 上限，因此由瀏覽器直接呼叫；
// session cookie 與 Origin 由瀏覽器帶上，所有驗證以後端為準。
import { ACTION_FAILED_MESSAGE } from '@/lib/actionError';
import { envelopeData, envelopeError } from '@/lib/api/envelope';
import { fieldSize } from './signLayout';
import type { UploadField } from './types';

/** 後端的欄位位置：皆為頁面寬高百分比，(x, y) 為左上角 */
type ApiFieldPlacement = {
  type: 'signature' | 'date';
  page: number;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  sortOrder: number;
};

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** 後端以小數 3 位儲存，且要求位置 + 尺寸不超過 100；四捨五入後若超出就往內收 */
function fitInPage(pos: number, size: number) {
  let p = round3(pos);
  while (p > 0 && p + size > 100) p = round3(p - 0.001);
  return p;
}

/** 編輯器欄位轉成後端格式；依頁碼、由上而下、由左而右排序 */
function toApiFields(fields: UploadField[]): ApiFieldPlacement[] {
  return [...fields]
    .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)
    .map((f, index) => {
      const size = fieldSize(f);
      const widthPercent = round3(size.w);
      const heightPercent = round3(size.h);
      return {
        type: f.type === 'sign' ? 'signature' : 'date',
        page: f.page,
        xPercent: fitInPage(f.x, widthPercent),
        yPercent: fitInPage(f.y, heightPercent),
        widthPercent,
        heightPercent,
        sortOrder: index,
      };
    });
}

/** 從後端成功回應取出文件 id；格式不符時回傳 null */
function documentId(body: unknown): string | null {
  const data = envelopeData(body);
  if (typeof data !== 'object' || data === null || !('id' in data)) return null;
  return typeof data.id === 'string' ? data.id : null;
}

/** 後端文件的 id 為正整數字串（mock store 的 id 以 f 開頭） */
export function isBackendDocumentId(id: string) {
  return /^[1-9][0-9]*$/.test(id);
}

/** 以 multipart 送出文件；成功回傳文件 id，可預期的錯誤回傳繁體中文訊息 */
async function sendDocument(url: string, method: 'POST' | 'PATCH', body: FormData): Promise<{ id: string } | { error: string }> {
  let res: Response;
  try {
    res = await fetch(url, { method, body });
  } catch {
    return { error: '無法連線到伺服器，請檢查網路後再試一次' };
  }
  if (redirectExpiredSession(res)) return { error: '登入已失效，請重新登入後再試一次' };
  if (res.status === 413) return { error: '檔案超過 20MB，請壓縮後再上傳' };

  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) return { error: envelopeError(json) ?? ACTION_FAILED_MESSAGE };
  const id = documentId(json);
  return id ? { id } : { error: ACTION_FAILED_MESSAGE };
}

/**
 * 上傳 PDF 並建立草稿，同一請求帶入簽名／日期欄位（尚未指派簽署人，發起時再指派）。
 * 後端在同一交易寫入 PDF、草稿與欄位，任一不合法則整筆不建立。
 */
export function createUploadDocument(input: {
  title: string;
  file: File;
  fields: UploadField[];
}): Promise<{ id: string } | { error: string }> {
  const body = new FormData();
  body.append('title', input.title);
  body.append('file', input.file);
  body.append('fields', JSON.stringify(toApiFields(input.fields)));
  return sendDocument('/api/esign/documents', 'POST', body);
}

/**
 * 修改草稿：標題、（重新上傳時）PDF 與簽名／日期欄位一次送出。
 * 欄位整批取代且一律未指派簽署人；換了 PDF 時後端依新 PDF 的頁數檢查欄位。
 */
export function updateUploadDocument(input: {
  id: string;
  title: string;
  file?: File;
  fields: UploadField[];
}): Promise<{ id: string } | { error: string }> {
  const body = new FormData();
  body.append('title', input.title);
  if (input.file) body.append('file', input.file);
  body.append('fields', JSON.stringify(toApiFields(input.fields)));
  return sendDocument(`/api/esign/documents/${encodeURIComponent(input.id)}`, 'PATCH', body);
}

const SIGNER_PUBLIC_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 後端的文件 id（建立人）或簽署任務 id（signerPublicId）；mock store 的 id 以 f 開頭 */
export function isBackendId(id: string) {
  return isBackendDocumentId(id) || SIGNER_PUBLIC_ID.test(id);
}

/**
 * 下載後端文件全員簽署完成的 PDF（經 /files/forms/[id] 轉向後端）。
 * Spec 03 不提供個人簽署副本，文件完成前無法下載；失敗時回傳繁體中文訊息。
 */
export async function downloadCompletedPdf(id: string, fileName: string): Promise<{ error: string } | undefined> {
  let res: Response;
  try {
    res = await fetch(`/files/forms/${encodeURIComponent(id)}?variant=completed`, { cache: 'no-store' });
  } catch {
    return { error: '無法連線到伺服器，請檢查網路後再試一次' };
  }
  if (res.status === 409) return { error: '文件全部簽署完成後才能下載' };
  if (redirectExpiredSession(res)) return { error: '登入已失效，請重新登入後再試一次' };
  if (!res.ok) return { error: '下載失敗，請稍後再試' };
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // 等瀏覽器開始下載後再釋放
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
