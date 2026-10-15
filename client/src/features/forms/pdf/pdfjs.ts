import { redirectExpiredSession } from '@/features/auth/navigation';
// 在瀏覽器端用 pdf.js 讀取 PDF：取得實際頁數並把指定頁面畫成圖片（上傳預覽、簽署時閱讀原始文件）。
// TODO: 串接後端後可改由後端轉檔（Word → PDF）並回傳預覽圖。
import type { PDFDocumentProxy } from 'pdfjs-dist';

/** 單檔上限：避免瀏覽器一次讀入過大的檔案 */
export const MAX_PDF_BYTES = 20 * 1024 * 1024;

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

/** pdf.js 較大，第一次用到時才載入，並指定 worker 檔案位置 */
function loadPdfjs() {
  pdfjsPromise ??= import('pdfjs-dist').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
    return pdfjs;
  });
  return pdfjsPromise;
}

export const isPdfFile = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

/** 開啟 PDF（本機檔案或同源網址）；密碼保護或格式錯誤時丟出錯誤 */
export async function openPdf(source: File | string): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  if (typeof source === 'string') {
    const res = await fetch(source, { cache: 'no-store' });
    if (source.startsWith('/files/forms/') && redirectExpiredSession(res)) throw new Error('登入已失效');
    if (!res.ok) throw new Error(`無法取得文件（${res.status}）`);
    return pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise;
  }
  return pdfjs.getDocument({ data: new Uint8Array(await source.arrayBuffer()) }).promise;
}

/** 把指定頁（從 1 開始）畫成指定寬度（px）的 PNG data URL */
export async function renderPdfPage(doc: PDFDocumentProxy, pageNumber: number, width: number): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport }).promise;
  page.cleanup();
  return canvas.toDataURL('image/png');
}
