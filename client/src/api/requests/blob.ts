import api from '@/api/config';
import axios from 'axios';

/** 以 GET 下載檔案（Blob）；失敗時把錯誤內容轉回 JSON，讓 getErrorMessage 讀得到後端訊息 */
export const getBlob = async (url: string): Promise<Blob> => {
  try {
    const res = await api<Blob>({ method: 'GET', url, responseType: 'blob' });
    return res.data;
  } catch (error) {
    // 以 blob 接收時錯誤內容也是 Blob
    if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
      try {
        error.response.data = JSON.parse(await error.response.data.text());
      } catch {
        // 不是 JSON 時維持原樣
      }
    }
    throw error;
  }
};

