import api from '@/api/config';
import { endpoints } from '@/api/endpoints';
import type {
  CreateDocumentBody,
  EsignDocumentDetail,
  EsignDocumentListItem,
  EsignSignerCandidate,
  GetDocumentsParams,
  InitiateDocumentBody,
} from '@/api/types';

/**
 * @name 列出電子簽文件
 * @description 依角色與狀態查詢目前登入員工可見的文件，依更新時間由新到舊；不分頁
 */
export const getDocuments = async (params: GetDocumentsParams = {}): Promise<EsignDocumentListItem[]> => {
  const res = await api<EsignDocumentListItem[]>({ method: 'GET', url: endpoints.ESIGN_DOCUMENTS, params });
  return res.data;
};

/**
 * @name 上傳 PDF 並建立草稿
 * @description 回傳新文件的 id，接著前往設定簽署
 */
export const createDocument = async ({ title, file, fields }: CreateDocumentBody): Promise<{ id: string }> => {
  const body = new FormData();
  body.append('title', title);
  if (fields) body.append('fields', JSON.stringify(fields));
  body.append('file', file);
  // 需明確指定 multipart：instance 預設 JSON，axios 會把 FormData 轉成 JSON 送出（boundary 由瀏覽器補上）
  const res = await api<{ id: string }>({
    method: 'POST',
    url: endpoints.ESIGN_DOCUMENTS,
    data: body,
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
};

/**
 * @name 取得建立人的文件詳情
 * @description 含簽署人、欄位與原始 PDF 資訊；只有建立人可讀取
 */
export const getDocument = async (id: string): Promise<EsignDocumentDetail> => {
  const res = await api<EsignDocumentDetail>({ method: 'GET', url: endpoints.ESIGN_DOCUMENT(id) });
  return res.data;
};

/**
 * @name 發起文件簽署
 * @description 一次送出簽署人、欄位指派、簽署期間與可選功能，草稿轉為簽署中；回傳發起後的文件詳情
 */
export const initiateDocument = async ({
  id,
  body,
}: {
  id: string;
  body: InitiateDocumentBody;
}): Promise<EsignDocumentDetail> => {
  const res = await api<EsignDocumentDetail>({
    method: 'POST',
    url: endpoints.ESIGN_DOCUMENT_INITIATIONS(id),
    data: body,
  });
  return res.data;
};

/**
 * @name 停止文件簽署
 * @description 建立人提供原因（1～500 字）停止簽署中的文件；尚未簽署的人將無法再簽署。回傳停止後的文件詳情
 */
export const stopDocument = async ({ id, reason }: { id: string; reason: string }): Promise<EsignDocumentDetail> => {
  const res = await api<EsignDocumentDetail>({
    method: 'POST',
    url: endpoints.ESIGN_DOCUMENT_STOPPAGES(id),
    data: { reason },
  });
  return res.data;
};

/**
 * @name 刪除草稿
 * @description 僅建立人可刪除尚未發起的文件（後端軟刪除並保留稽核紀錄）；成功時回 204 無內容
 */
export const deleteDocument = async (id: string): Promise<void> => {
  await api({ method: 'DELETE', url: endpoints.ESIGN_DOCUMENT(id) });
};

/**
 * @name 查詢內部簽署人候選
 * @description 以關鍵字或完整八碼員編查詢；本地查無完整員編時，後端會向饗賓人 API 查詢並建立帳號
 */
export const getSignerCandidates = async (q: string): Promise<EsignSignerCandidate[]> => {
  const res = await api<EsignSignerCandidate[]>({ method: 'GET', url: endpoints.ESIGN_SIGNER_CANDIDATES, params: { q } });
  return res.data;
};

/** 建立人讀取原始 PDF 的網址（pdf.js 直接讀取，同源請求會帶上 session cookie） */
export const documentSourceFileUrl = (id: string) =>
  `${api.defaults.baseURL}/${endpoints.ESIGN_DOCUMENT_SOURCE_FILE(id)}`;
