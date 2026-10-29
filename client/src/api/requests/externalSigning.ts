import api from '@/api/config';
import axios from 'axios';
import { endpoints } from '@/api/endpoints';
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

/** 本人副本的下載網址（一般連結直接下載附件，同源請求會帶上外部存取 cookie） */
export const externalCompletedFileUrl = () =>
  `${api.defaults.baseURL}/${endpoints.EXTERNAL_SIGNING_TASK_COMPLETED_FILE}`;

/** 下載時保留 JSON 授權錯誤，讓切換中的舊內部 cookie 顯示 Portal 引導。 */
export const downloadExternalCompletedFile = async (): Promise<{ bytes: Blob; fileName: string }> => {
  try {
    const res = await api<Blob>({ method: 'GET', url: endpoints.EXTERNAL_SIGNING_TASK_COMPLETED_FILE, responseType: 'blob' });
    const disposition: unknown = res.headers['content-disposition'];
    const encoded = typeof disposition === 'string' ? /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1] : undefined;
    if (!encoded) throw new Error('下載檔名格式不正確');
    return { bytes: res.data, fileName: decodeURIComponent(encoded) };
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data instanceof Blob && error.response.data.type.includes('json')) {
      try { error.response.data = JSON.parse(await error.response.data.text()); } catch { /* 非 JSON 錯誤仍交給既有通用訊息。 */ }
    }
    throw error;
  }
};
