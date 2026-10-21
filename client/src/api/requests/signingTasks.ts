import api from '@/api/config';
import { endpoints } from '@/api/endpoints';
import type {
  EsignSignatureResult,
  EsignSigningTask,
  GetSigningTasksParams,
  SubmitSignaturesBody,
} from '@/api/types';
import { getBlob } from './blob';

/**
 * @name 列出本人的簽署任務
 * @description 指派給目前員工、已發起的文件（含已停止、已到期）；不分頁
 */
export const getSigningTasks = async (params: GetSigningTasksParams = {}): Promise<EsignSigningTask[]> => {
  const res = await api<EsignSigningTask[]>({ method: 'GET', url: endpoints.ESIGN_SIGNING_TASKS, params });
  return res.data;
};

/**
 * @name 開啟簽署任務
 * @description 確認任務仍在簽署期間內可簽署，並記錄「開啟文件」事件；回傳最新的任務資料
 */
export const openSigningTask = async (signerPublicId: string): Promise<EsignSigningTask> => {
  const res = await api<EsignSigningTask>({ method: 'POST', url: endpoints.ESIGN_SIGNING_TASK(signerPublicId) });
  return res.data;
};

/**
 * @name 送出簽名
 * @description 送出同意告知版本與各簽名欄位的 PNG；同一個 requestId 重送時回傳第一次的結果
 */
export const submitSignatures = async ({
  signerPublicId,
  body,
}: {
  signerPublicId: string;
  body: SubmitSignaturesBody;
}): Promise<EsignSignatureResult> => {
  const res = await api<EsignSignatureResult>({
    method: 'POST',
    url: endpoints.ESIGN_SIGNING_TASK_SIGNATURES(signerPublicId),
    data: body,
  });
  return res.data;
};

/**
 * @name 下載本人的已簽署文件
 * @description 個人簽署副本產製完成後才能下載；回傳 PDF 檔
 */
export const downloadMyCompletedFile = (signerPublicId: string): Promise<Blob> =>
  getBlob(endpoints.ESIGN_SIGNING_TASK_COMPLETED_FILE(signerPublicId));

/** 簽署人讀取原始 PDF 的網址（pdf.js 直接讀取，同源請求會帶上 session cookie）；只有簽署期間內或本人已簽署時可讀 */
export const signingTaskSourceFileUrl = (signerPublicId: string) =>
  `${api.defaults.baseURL}/${endpoints.ESIGN_SIGNING_TASK_SOURCE_FILE(signerPublicId)}`;
