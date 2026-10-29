import api from '@/api/config';
import { endpoints } from '@/api/endpoints';
import { downloadNamedFile } from './blob';
import type { EsignSigningTask, GetSigningTasksParams, SubmitSigningTaskBody, SigningTaskSignatureResult, RejectSigningTaskBody, SigningTaskRejectionResult } from '@/api/types';

/**
 * @name 列出本人的簽署任務
 * @description 指派給目前員工、已發起的文件（含已停止、已到期）；不分頁。
 */
export const getSigningTasks = async (params: GetSigningTasksParams = {}): Promise<EsignSigningTask[]> => {
  const res = await api<EsignSigningTask[]>({ method: 'GET', url: endpoints.ESIGN_SIGNING_TASKS, params });
  return res.data;
};

/** 開啟本人任務並記錄一次開啟事件；不作輪詢。 */
export const openSigningTask = async (signerPublicId: string): Promise<EsignSigningTask> => {
  const res = await api<EsignSigningTask>({ method: 'POST', url: endpoints.ESIGN_SIGNING_TASK(signerPublicId) });
  return res.data;
};

export const submitSigningTaskSignatures = async (
  signerPublicId: string,
  body: SubmitSigningTaskBody,
): Promise<SigningTaskSignatureResult> => {
  const res = await api<SigningTaskSignatureResult>({ method: 'POST', url: endpoints.ESIGN_SIGNING_TASK_SIGNATURES(signerPublicId), data: body });
  return res.data;
};

export const signingTaskSourceFileUrl = (signerPublicId: string) =>
  `${api.defaults.baseURL}/${endpoints.ESIGN_SIGNING_TASK_SOURCE_FILE(signerPublicId)}`;

export const rejectSigningTask = async (signerPublicId: string, body: RejectSigningTaskBody): Promise<SigningTaskRejectionResult> => {
  const res = await api<SigningTaskRejectionResult>({ method: 'POST', url: endpoints.ESIGN_SIGNING_TASK_REJECTION(signerPublicId), data: body });
  return res.data;
};

/**
 * 以 API 請求下載本人副本，讓登入過期與業務錯誤仍由全域 provider 處理。
 * POST：後端在送出檔案的同一請求寫入一筆「單人 PDF」匯出紀錄（Spec 015）
 */
export const downloadSigningTaskCompletedFile = (signerPublicId: string): Promise<{ bytes: Blob; fileName: string }> =>
  downloadNamedFile(endpoints.ESIGN_SIGNING_TASK_COMPLETED_FILE(signerPublicId), 'POST');
