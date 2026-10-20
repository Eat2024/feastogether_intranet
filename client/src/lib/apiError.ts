// 後端 API 錯誤（axios）轉成使用者看得懂的訊息
import { ERROR_CODE_MAP } from '@/api/errorCodes';
import type { ApiErrorResponse } from '@/api/types';
import axios from 'axios';

const DEFAULT_MESSAGE = '發生錯誤，請稍後再試';

/**
 * 優先使用後端回傳的 message（後端已在 server/src/common/errors/app-errors.ts 為每種錯誤定義中文訊息，
 * 同一個 code 底下有多種原因，例如 INVALID_REQUEST）；沒有 message 時才用 code 對照訊息，再沒有就用預設訊息
 */
export const getErrorMessage = (error: unknown, defaultValue: string = DEFAULT_MESSAGE): string => {
  if (axios.isAxiosError<ApiErrorResponse>(error)) {
    if (!error.response) return '無法連線到伺服器，請檢查網路後再試';
    const { code, message } = error.response.data?.error ?? {};
    // 登入過期：後端訊息（例如「請先登入」）沒有說明要從入口網重新進入，改用前端訊息
    if (error.response.status === 401 || code === 'UNAUTHORIZED') return ERROR_CODE_MAP.UNAUTHORIZED;
    if (message?.trim()) return message;
    if (code && ERROR_CODE_MAP[code]) return ERROR_CODE_MAP[code];
    return defaultValue;
  }
  return defaultValue;
};

/** 取出後端 error.code；不是 axios 錯誤或沒有 code 時回傳 undefined */
export const getErrorCode = (error: unknown): string | undefined =>
  axios.isAxiosError<ApiErrorResponse>(error) ? error.response?.data?.error?.code : undefined;

/** 外部簽署存取失效（邀請無效、過期或 cookie 已不存在），一律 401；不是員工登入過期 */
export const isExternalAccessLost = (error: unknown): boolean => getErrorCode(error) === 'ESIGN_EXTERNAL_UNAUTHORIZED';
