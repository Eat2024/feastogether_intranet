import api from '@/api/config';
import { endpoints } from '@/api/endpoints';
import type { EsignExportHistory, EsignExportJob, EsignExportRequestResult, ExportHistoryParams } from '@/api/types';

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
 * @name 查詢匯出紀錄
 * @description 依時間由新到舊，以 cursor 分頁；可指定文件
 */
export const getExportHistory = async (params: ExportHistoryParams = {}): Promise<EsignExportHistory> => {
  const res = await api<EsignExportHistory>({ method: 'GET', url: endpoints.ESIGN_EXPORTS, params });
  return res.data;
};

/** 下載 ZIP 的網址：檔案可能很大，以瀏覽器直接下載（同源請求會帶上 session cookie），不先讀進記憶體 */
export const documentExportFileUrl = (id: string, exportId: string, fileId: string) =>
  `${api.defaults.baseURL}/${endpoints.ESIGN_DOCUMENT_EXPORT_FILE(id, exportId, fileId)}`;
