import api from '@/api/config';
import { endpoints } from '@/api/endpoints';
import type { RejectionBody, RejectionResult, ExternalSignatureResult, ExternalSigningTask, SubmitExternalSignaturesBody } from '@/api/types';

/**
 * @name 開啟外部簽署任務
 * @description 以外部存取 cookie 取得本人的簽署任務，後端記錄開啟文件；存取失效時回 401
 */
export const openExternalSigningTask = async (): Promise<ExternalSigningTask> => {
  const res = await api<ExternalSigningTask>({ method: 'POST', url: endpoints.EXTERNAL_SIGNING_TASK });
  return res.data;
};

/**
 * @name 查詢外部簽署任務
 * @description 唯讀，不記錄開啟；簽署完成頁用來更新本人副本狀態，存取失效時回 401
 */
export const getExternalSigningTask = async (): Promise<ExternalSigningTask> => {
  const res = await api<ExternalSigningTask>({ method: 'GET', url: endpoints.EXTERNAL_SIGNING_TASK });
  return res.data;
};

/**
 * @name 送出外部簽署人簽名
 * @description 一次送出同意聲明版本與所有簽名欄位；網路重試沿用同一個 requestId，重送回既有結果
 */
export const submitExternalSignatures = async (body: SubmitExternalSignaturesBody): Promise<ExternalSignatureResult> => {
  const res = await api<ExternalSignatureResult>({
    method: 'POST',
    url: endpoints.EXTERNAL_SIGNING_TASK_SIGNATURES,
    data: body,
  });
  return res.data;
};

/** 外部簽署人讀取原始 PDF 的網址（pdf.js 直接讀取，同源請求會帶上外部存取 cookie） */
export const externalSourceFileUrl = () => `${api.defaults.baseURL}/${endpoints.EXTERNAL_SIGNING_TASK_SOURCE_FILE}`;

/** 本人副本的下載網址（一般連結直接下載附件，同源請求會帶上外部存取 cookie） */
export const externalCompletedFileUrl = () =>
  `${api.defaults.baseURL}/${endpoints.EXTERNAL_SIGNING_TASK_COMPLETED_FILE}`;

export async function rejectExternalTask(body: RejectionBody & { signerPublicId: string }): Promise<RejectionResult> {
  return (await api<RejectionResult>({ method: 'POST', url: endpoints.EXTERNAL_REJECTION, data: body })).data;
}

export async function getInternalSigningTasks(): Promise<ExternalSigningTask[]> {
  return (await api<ExternalSigningTask[]>({ method: 'GET', url: endpoints.INTERNAL_SIGNING_TASKS })).data;
}

export async function rejectInternalTask(id: string, body: RejectionBody): Promise<RejectionResult> {
  return (await api<RejectionResult>({ method: 'POST', url: endpoints.INTERNAL_REJECTION(id), data: body })).data;
}

export const internalSourceFileUrl = (id: string) => `${api.defaults.baseURL}/${endpoints.INTERNAL_SOURCE(id)}`;
