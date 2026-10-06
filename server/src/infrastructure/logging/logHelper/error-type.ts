import { isAxiosError } from 'axios';

/** 將任意錯誤收斂為不含原始訊息或 payload 的安全分類。 */
export function getErrorType(error: unknown): string {
  if (isAxiosError(error)) return error.name || 'AxiosError';
  if (error instanceof Error) return error.name;
  return 'UnknownError';
}
