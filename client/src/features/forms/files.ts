// 上傳文件的原始檔（僅供伺服器端使用）。
// 示意：存在伺服器記憶體，重新啟動即清空；串接後端後改存檔案儲存服務（並由後端轉檔、產生預覽）。
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

type StoredFile = { id: string; name: string; bytes: Uint8Array; pages: number; createdAt: number };

const g = globalThis as typeof globalThis & { __uploadedFiles?: Map<string, StoredFile> };
const files = () => (g.__uploadedFiles ??= new Map());

const FILE_ID = /^[0-9a-f-]{36}$/;

/**
 * 檢查並保存上傳的 PDF：確認是 PDF、大小在上限內、沒有密碼保護，並由伺服器端讀出實際頁數。
 */
export async function savePdf(name: string, bytes: Uint8Array): Promise<{ id: string; pages: number } | { error: string }> {
  if (bytes.byteLength === 0) return { error: '檔案是空的' };
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return { error: `檔案超過 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB` };
  // PDF 檔頭
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') return { error: '目前只支援 PDF 檔' };
  let pages: number;
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    pages = doc.getPageCount();
  } catch (err) {
    const encrypted = err instanceof Error && /encrypt/i.test(err.message);
    return { error: encrypted ? '此 PDF 有密碼保護，請移除密碼後再上傳' : '無法讀取此 PDF，檔案可能已損毀' };
  }
  if (pages === 0) return { error: '此 PDF 沒有任何頁面' };
  const id = randomUUID();
  files().set(id, { id, name, bytes, pages, createdAt: Date.now() });
  return { id, pages };
}

export function getStoredFile(id: string | undefined): StoredFile | undefined {
  return id && FILE_ID.test(id) ? files().get(id) : undefined;
}
