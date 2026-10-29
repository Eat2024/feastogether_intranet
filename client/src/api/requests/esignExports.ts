import api from '@/api/config';
import { endpoints } from '@/api/endpoints';
import type {
  CreateExcelExportRecordBody,
  EsignExportJob,
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
 * @description 依類型（excel／pdf／zip）以頁碼查詢所有人的匯出紀錄，依匯出時間由新到舊；可限定文件
 */
export const getExportHistory = async <T extends ExportHistoryType>(
  params: ExportHistoryParams<T>,
): Promise<ExportHistoryPage<T>> => {
  const res = await api<ExportHistoryPage<T>>({ method: 'GET', url: endpoints.ESIGN_EXPORT_HISTORY, params });
  return res.data;
};

/**
 * @name 記錄 Excel 匯出
 * @description 首次匯出與重新下載共用；記錄成功後才在瀏覽器產生 Excel。回傳新紀錄
 */
export const createExcelExportRecord = async (body: CreateExcelExportRecordBody): Promise<ExcelExportHistoryItem> => {
  const res = await api<ExcelExportHistoryItem>({ method: 'POST', url: endpoints.ESIGN_EXPORT_HISTORY, data: body });
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
 * @description 只接受 pdf 紀錄；回該簽署人目前的已簽副本，並新增一筆匯出人為目前使用者的紀錄
 */
export const redownloadPdfExport = (recordId: string): Promise<{ bytes: Blob; fileName: string }> =>
  downloadNamedFile(endpoints.ESIGN_EXPORT_HISTORY_DOWNLOADS(recordId), 'POST');

/** 下載 ZIP 的網址：檔案可能很大，以瀏覽器直接下載（同源請求會帶上 session cookie），不先讀進記憶體 */
export const documentExportFileUrl = (id: string, exportId: string, fileId: string) =>
  `${api.defaults.baseURL}/${endpoints.ESIGN_DOCUMENT_EXPORT_FILE(id, exportId, fileId)}`;
