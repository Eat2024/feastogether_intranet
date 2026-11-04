import api from '@/api/config';
import { endpoints } from '@/api/endpoints';
import type {
  CreateExcelExportRecordBody,
  PrepareExportDownloadBody,
  PreparedExportDownload,
  EsignExportJob,
  EsignExportPreviewDocument,
  EsignExportRequestResult,
  ExcelExportDocument,
  ExcelExportHistoryItem,
  ExportHistoryPage,
  ExportHistoryParams,
  ExportHistoryType,
} from '@/api/types';
import { downloadNamedFile } from './blob';

/**
 * @name 產生已簽署副本 ZIP
 * @description 受理後由後端背景打包；已有可沿用的匯出工作時直接回傳（reused 為 true）。沒有任何已簽署副本時回錯誤
 */
export const requestDocumentExport = async (id: string): Promise<EsignExportRequestResult> => {
  const res = await api<EsignExportRequestResult>({
    method: 'POST',
    url: endpoints.ESIGN_DOCUMENT_EXPORTS(id),
    data: { type: 'signed_copies_zip' },
  });
  return res.data;
};

/**
 * @name 查詢匯出工作
 * @description 回傳進度；完成後附上可下載的檔案
 */
export const getDocumentExport = async (id: string, exportId: string): Promise<EsignExportJob> => {
  const res = await api<EsignExportJob>({ method: 'GET', url: endpoints.ESIGN_DOCUMENT_EXPORT(id, exportId) });
  return res.data;
};

/**
 * @name 重試失敗的匯出
 * @description 只有失敗（且不是文件完整性錯誤）的工作可以重試
 */
export const retryDocumentExport = async ({ id, exportId }: { id: string; exportId: string }): Promise<EsignExportJob> => {
  const res = await api<EsignExportJob>({ method: 'POST', url: endpoints.ESIGN_DOCUMENT_EXPORT_RETRIES(id, exportId) });
  return res.data;
};

/**
 * @name 查詢歷史匯出紀錄
 * @description 依類型（excel／pdf／zip）、關鍵字與頁碼查詢同部門文件的匯出紀錄，依匯出時間由新到舊；可限定文件
 */
export const getExportHistory = async <T extends ExportHistoryType>(
  params: ExportHistoryParams<T>,
): Promise<ExportHistoryPage<T>> => {
  const res = await api<ExportHistoryPage<T>>({ method: 'GET', url: endpoints.ESIGN_EXPORT_HISTORY, params });
  return res.data;
};

// 後端每頁上限
const EXPORT_HISTORY_MAX_PAGE_SIZE = 100;

/**
 * @name 查詢某類型的全部歷史匯出紀錄
 * @description 後端沒有排序參數：在前端排序時，依類型與關鍵字逐頁取回全部紀錄（每頁 100 筆，第一頁之後並行）。
 * 取回期間若有新紀錄，頁面位移可能造成重複，以 id 去除
 */
export const getAllExportHistory = async <T extends ExportHistoryType>(
  params: Omit<ExportHistoryParams<T>, 'page' | 'pageSize'>,
): Promise<Pick<ExportHistoryPage<T>, 'items' | 'total' | 'typeTotals'>> => {
  const pageSize = EXPORT_HISTORY_MAX_PAGE_SIZE;
  const first = await getExportHistory({ ...params, page: 1, pageSize });
  const pageCount = Math.ceil(first.total / pageSize);
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pageCount - 1) }, (_, i) => getExportHistory({ ...params, page: i + 2, pageSize })),
  );
  const byId = new Map([first, ...rest].flatMap((p) => p.items).map((item) => [item.id, item]));
  return { items: [...byId.values()], total: first.total, typeTotals: first.typeTotals };
};

/**
 * @name 記錄 Excel 匯出
 * @description 僅新匯出使用；記錄成功後才在瀏覽器產生 Excel，並以回傳的 downloadFileName 下載
 */
export const createExcelExportRecord = async (
  body: CreateExcelExportRecordBody,
): Promise<ExcelExportHistoryItem & { downloadFileName: string }> => {
  const res = await api<ExcelExportHistoryItem & { downloadFileName: string }>({
    method: 'POST',
    url: endpoints.ESIGN_EXPORT_HISTORY,
    data: body,
  });
  return res.data;
};

/**
 * @name 取得 Excel 重新下載用的文件資料
 * @description 只接受 excel 紀錄；回文件目前的資料（唯讀，不新增紀錄）
 */
export const getExcelExportDocument = async (recordId: string): Promise<ExcelExportDocument> => {
  const res = await api<ExcelExportDocument>({ method: 'GET', url: endpoints.ESIGN_EXPORT_HISTORY_DOCUMENT(recordId) });
  return res.data;
};

/**
 * @name 重新下載單人 PDF
 * @description 只接受 pdf 紀錄；回該簽署人目前的已簽副本，不新增紀錄
 */
export const redownloadPdfExport = (recordId: string): Promise<{ bytes: Blob; fileName: string }> =>
  downloadNamedFile(endpoints.ESIGN_EXPORT_HISTORY_DOWNLOADS(recordId), 'POST');

/** 下載 ZIP 的網址：檔案可能很大，以瀏覽器直接下載（同源請求會帶上 session cookie），不先讀進記憶體 */
export const documentExportFileUrl = (id: string, exportId: string, fileId: string) =>
  `${api.defaults.baseURL}/${endpoints.ESIGN_DOCUMENT_EXPORT_FILE(id, exportId, fileId)}`;

/** 同部門文件的完整 Excel 匯出預覽；讀取不產生匯出紀錄。 */
export const getDocumentExportPreview = async (id: string): Promise<EsignExportPreviewDocument> => {
  const res = await api<EsignExportPreviewDocument>({
    method: 'GET',
    url: endpoints.ESIGN_DOCUMENT(id),
    params: { view: 'export' },
  });
  return res.data;
};

/** 驗證當次匯出名稱與資格；不保存設定、不產檔或記錄匯出。 */
export const prepareExportDownload = async (id: string, body: PrepareExportDownloadBody): Promise<PreparedExportDownload> => {
  const res = await api<PreparedExportDownload>({
    method: 'POST',
    url: endpoints.ESIGN_DOCUMENT_EXPORT_DOWNLOADS(id),
    data: body,
  });
  return res.data;
};

/** 只接受準備下載 API 的同源 ZIP 路徑；檔名永遠不放在 URL。 */
export const preparedExportFileUrl = (path: string): string => {
  if (!/^\/api\/esign\/documents\/[1-9]\d*\/exports\/[0-9a-f-]{36}\/files\/[1-9]\d*(?:\?downloadName=client)?$/i.test(path)) {
    throw new Error('下載路徑格式不正確');
  }
  return new URL(path, window.location.origin).href;
};
