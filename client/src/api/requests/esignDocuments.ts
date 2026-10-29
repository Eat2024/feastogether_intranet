import api from '@/api/config';
import { endpoints } from '@/api/endpoints';
import type {
  CreateDocumentBody,
  CreateNotificationBatchBody,
  DraftSettingsBody,
  EsignDocumentDetail,
  EsignDocumentListItem,
  EsignEmployeeEmailCheck,
  EsignHistoryItem,
  EsignNotificationBatch,
  EsignNotificationBatchList,
  EsignOrgDepartment,
  EsignSignerCandidate,
  EsignSignerResolution,
  GetDocumentsParams,
  InitiateDocumentBody,
  NotificationListParams,
  NotificationPageParams,
  ReopenDocumentBody,
  ReopenDocumentResult,
  ReopeningInvitation,
  SaveSignerNoteBody,
  SignerNoteResult,
  UpdateDocumentBody,
} from '@/api/types';
import { downloadFile } from './blob';

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
 * @name 修改草稿
 * @description 僅建立人可修改尚未發起的文件；可改名稱、換 PDF（會清除舊欄位）、整批取代欄位
 */
export const updateDocument = async ({ id, title, file, fields }: UpdateDocumentBody): Promise<{ id: string }> => {
  const body = new FormData();
  if (title !== undefined) body.append('title', title);
  if (fields) body.append('fields', JSON.stringify(fields));
  if (file) body.append('file', file);
  const res = await api<{ id: string }>({
    method: 'PATCH',
    url: endpoints.ESIGN_DOCUMENT(id),
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
 * @name 查詢文件簽署歷程
 * @description 建立人可看到文件的所有事件（依時間由舊到新），含停止原因
 */
export const getDocumentHistory = async (id: string): Promise<EsignHistoryItem[]> => {
  const res = await api<EsignHistoryItem[]>({ method: 'GET', url: endpoints.ESIGN_DOCUMENT_HISTORY(id) });
  return res.data;
};

/**
 * @name 暫存草稿設定
 * @description 在同一交易保存簽署人名單、簽署期間與可選功能，不發起、不寄送邀請；回傳儲存後的文件詳情
 */
export const saveDraftSettings = async ({
  id,
  body,
}: {
  id: string;
  body: DraftSettingsBody;
}): Promise<EsignDocumentDetail> => {
  const res = await api<EsignDocumentDetail>({
    method: 'PATCH',
    url: endpoints.ESIGN_DOCUMENT_DRAFT_SETTINGS(id),
    data: body,
  });
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
 * @name 下載簽署人的個人簽署副本
 * @description 僅建立人可下載，且該簽署人的個人副本須已產製完成；回傳 PDF 檔。
 * POST：後端在送出檔案的同一請求寫入一筆「單人 PDF」匯出紀錄（Spec 015）
 */
export const downloadSignerCompletedFile = async ({
  id,
  signerPublicId,
}: {
  id: string;
  signerPublicId: string;
}): Promise<Blob> => (await downloadFile(endpoints.ESIGN_SIGNER_COMPLETED_FILE(id, signerPublicId), 'POST')).bytes;

/**
 * @name 查詢內部簽署人候選
 * @description 依關鍵字查詢本機已有帳號的員工，不向饗賓人 API 查詢、不建立帳號；
 * 從組織架構選取的同仁請改用 resolveSignerCandidates
 */
export const getSignerCandidates = async (q: string): Promise<EsignSignerCandidate[]> => {
  const res = await api<EsignSignerCandidate[]>({ method: 'GET', url: endpoints.ESIGN_SIGNER_CANDIDATES, params: { q } });
  return res.data;
};

/**
 * @name 查詢正式員工組織架構
 * @description 選擇簽署人用；後端快取 2 小時，來源暫時無法使用時回 502／503。含員工個資，勿寫入網址或紀錄
 */
export const getSignerOrgChart = async (): Promise<EsignOrgDepartment[]> => {
  const res = await api<EsignOrgDepartment[]>({ method: 'GET', url: endpoints.ESIGN_SIGNER_ORG_CHART });
  return res.data;
};

/**
 * @name 解析選取的員工為簽署人
 * @description 以完整員編（一次最多 100 個）換成後端 userId；本機沒有帳號時後端會向饗賓人 API 查詢並建立帳號
 */
export const resolveSignerCandidates = async (employeeNos: string[]): Promise<EsignSignerResolution[]> => {
  const res = await api<{ items: EsignSignerResolution[] }>({
    method: 'POST',
    url: endpoints.ESIGN_SIGNER_RESOLUTIONS,
    data: { employeeNos },
  });
  return res.data.items;
};

/** 建立人讀取原始 PDF 的網址（pdf.js 直接讀取，同源請求會帶上 session cookie） */
export const documentSourceFileUrl = (id: string) =>
  `${api.defaults.baseURL}/${endpoints.ESIGN_DOCUMENT_SOURCE_FILE(id)}`;

/**
 * @name 重新開放補簽
 * @description 已到期且仍有人未簽署時，由建立人設定新的截止時間與原因；只延後截止時間，已完成的簽署不受影響
 */
export const reopenDocument = async ({
  id,
  expectedSignEndAt,
  signEndAt,
  reason,
}: ReopenDocumentBody): Promise<ReopenDocumentResult> => {
  const res = await api<ReopenDocumentResult>({
    method: 'POST',
    url: endpoints.ESIGN_DOCUMENT_REOPENINGS(id),
    data: { expectedSignEndAt, signEndAt, reason },
  });
  return res.data;
};

/**
 * @name 儲存簽署人管理備註
 * @description 僅建立人；最多 30 字，空字串表示清除。不修改文件或簽署證據
 */
export const saveSignerNote = async ({ id, signerPublicId, note }: SaveSignerNoteBody): Promise<SignerNoteResult> => {
  const res = await api<SignerNoteResult>({
    method: 'PATCH',
    url: endpoints.ESIGN_SIGNER_NOTE(id, signerPublicId),
    data: { note },
  });
  return res.data;
};

/**
 * @name 取得補簽的外部邀請連結
 * @description 僅建立人；文件補簽中時回傳外部待簽署人的新邀請連結，不寄信、不更換憑證。連結即憑證，勿記錄或外流
 */
export const getReopeningInvitations = async (id: string): Promise<ReopeningInvitation[]> => {
  const res = await api<ReopeningInvitation[]>({ method: 'GET', url: endpoints.ESIGN_REOPENING_INVITATIONS(id) });
  return res.data;
};

/**
 * @name 建立外部催簽批次
 * @description 僅建立人；後端先受理再背景寄送，回傳受理結果而非已送達。沒有任何人可催簽時回錯誤並附逐人原因
 */
export const createNotificationBatch = async ({
  id,
  body,
}: {
  id: string;
  body: CreateNotificationBatchBody;
}): Promise<EsignNotificationBatch> => {
  const res = await api<EsignNotificationBatch>({
    method: 'POST',
    url: endpoints.ESIGN_NOTIFICATION_BATCHES(id),
    data: body,
  });
  return res.data;
};

/**
 * @name 查詢通知批次
 * @description 依時間由新到舊，以 cursor 分頁；可篩選初次邀請或催簽
 */
export const getNotificationBatches = async (
  id: string,
  params: NotificationListParams = {},
): Promise<EsignNotificationBatchList> => {
  const res = await api<EsignNotificationBatchList>({
    method: 'GET',
    url: endpoints.ESIGN_NOTIFICATION_BATCHES(id),
    params,
  });
  return res.data;
};

/**
 * @name 查詢通知批次的逐人結果
 * @description 以 cursor 分頁；不回傳郵件憑證
 */
export const getNotificationBatch = async (
  id: string,
  batchId: string,
  params: NotificationPageParams = {},
): Promise<EsignNotificationBatch> => {
  const res = await api<EsignNotificationBatch>({
    method: 'GET',
    url: endpoints.ESIGN_NOTIFICATION_BATCH(id, batchId),
    params,
  });
  return res.data;
};

/**
 * @name 檢查內部簽署人的收件信箱
 * @description 僅草稿建立人；以後端 userId 逐人檢查人事資料是否有信箱，只回遮罩結果，不保存信箱、不寄信。
 * 人事系統暫時無法使用時回錯誤
 */
export const checkEmployeeEmails = async ({
  id,
  userIds,
}: {
  id: string;
  userIds: string[];
}): Promise<EsignEmployeeEmailCheck[]> => {
  const res = await api<{ items: EsignEmployeeEmailCheck[] }>({
    method: 'POST',
    url: endpoints.ESIGN_DOCUMENT_EMPLOYEE_EMAIL_CHECKS(id),
    data: { userIds },
  });
  return res.data.items;
};
