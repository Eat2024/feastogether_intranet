import api from '@/api/config';
import axios from 'axios';

/**
 * 下載檔案（Blob）。PDF 下載路由為 POST（後端在送出檔案的同一請求寫入匯出紀錄），其餘為 GET。
 * 回傳檔案與 Content-Disposition 的 filename*（沒有時為 null）；失敗時把錯誤內容轉回 JSON，
 * 讓 getErrorMessage 與全域 provider（登入過期等）讀得到後端錯誤。
 */
export const downloadFile = async (
  url: string,
  method: 'GET' | 'POST' = 'GET',
): Promise<{ bytes: Blob; fileName: string | null }> => {
  try {
    const res = await api<Blob>({ method, url, responseType: 'blob' });
    const disposition: unknown = res.headers['content-disposition'];
    const encoded = typeof disposition === 'string' ? /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1] : undefined;
    return { bytes: res.data, fileName: encoded ? decodeURIComponent(encoded) : null };
  } catch (error) {
    // 以 blob 接收時錯誤內容也是 Blob
    if (axios.isAxiosError(error) && error.response?.data instanceof Blob && error.response.data.type.includes('json')) {
      try {
        error.response.data = JSON.parse(await error.response.data.text());
      } catch {
        // 不是 JSON 時維持原樣，交由通用訊息處理
      }
    }
    throw error;
  }
};

/** 本人副本等需要後端檔名的下載：沒有檔名時視為回應格式錯誤 */
export const downloadNamedFile = async (url: string, method: 'GET' | 'POST' = 'GET') => {
  const { bytes, fileName } = await downloadFile(url, method);
  if (!fileName) throw new Error('下載檔名格式不正確');
  return { bytes, fileName };
};
