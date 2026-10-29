import api from '@/api/config';
import { endpoints } from '@/api/endpoints';
import { downloadNamedFile } from './blob';
import type {
  ExternalRejectionResult,
  ExternalSignatureResult,
  ExternalSigningTask,
  RejectExternalSigningTaskBody,
  SubmitExternalSignaturesBody,
} from '@/api/types';

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

/**
 * @name 拒絕簽署
 * @description 本人待簽署、在簽署期間內，且建立人開放拒絕簽署時才能拒絕；同一個 requestId 與原因重送時回傳第一次的結果
 */
export const rejectExternalSigningTask = async (body: RejectExternalSigningTaskBody): Promise<ExternalRejectionResult> => {
  const res = await api<ExternalRejectionResult>({
    method: 'POST',
    url: endpoints.EXTERNAL_SIGNING_TASK_REJECTION,
    data: body,
  });
  return res.data;
};

/** 外部簽署人讀取原始 PDF 的網址（pdf.js 直接讀取，同源請求會帶上外部存取 cookie） */
export const externalSourceFileUrl = () => `${api.defaults.baseURL}/${endpoints.EXTERNAL_SIGNING_TASK_SOURCE_FILE}`;

/**
 * 下載本人副本；保留 JSON 授權錯誤，讓切換中的舊內部 cookie 顯示 Portal 引導。
 * POST：後端在送出檔案的同一請求寫入一筆「單人 PDF」匯出紀錄（Spec 015）
 */
export const downloadExternalCompletedFile = (): Promise<{ bytes: Blob; fileName: string }> =>
  downloadNamedFile(endpoints.EXTERNAL_SIGNING_TASK_COMPLETED_FILE, 'POST');
