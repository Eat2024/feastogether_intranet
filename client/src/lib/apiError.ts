// 後端 API 錯誤（axios）轉成使用者看得懂的訊息
import { ERROR_CODE_MAP } from '@/api/errorCodes';
import type { ApiErrorResponse } from '@/api/types';
import axios from 'axios';

const DEFAULT_MESSAGE = '發生錯誤，請稍後再試';

/** 依後端 error.code 取得對照訊息；沒有對照時用後端的 message，再沒有就用預設訊息 */
export const getErrorMessage = (error: unknown, defaultValue: string = DEFAULT_MESSAGE): string => {
  if (axios.isAxiosError<ApiErrorResponse>(error)) {
    if (!error.response) return '無法連線到伺服器，請檢查網路後再試';
    const code = error.response.data?.error?.code;
    if (code && ERROR_CODE_MAP[code]) return ERROR_CODE_MAP[code];
    return error.response.data?.error?.message ?? defaultValue;
  }
  return defaultValue;
};

/** 取出後端 error.code；不是 axios 錯誤或沒有 code 時回傳 undefined */
export const getErrorCode = (error: unknown): string | undefined =>
  axios.isAxiosError<ApiErrorResponse>(error) ? error.response?.data?.error?.code : undefined;
