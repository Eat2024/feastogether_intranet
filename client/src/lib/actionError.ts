// 呼叫 Server Action 時的非預期錯誤處理（網路中斷、伺服器錯誤、頁面開著時系統已更新導致找不到 action 等）。
// 可預期的驗證失敗由 action 回傳 { error }，不會走到這裡。

export const ACTION_FAILED_MESSAGE = '送出失敗，可能是網路中斷或系統剛更新，請重新整理頁面後再試一次。';

/** Next.js 的導頁（redirect、notFound）會以帶 digest 的錯誤表示，必須交還給框架處理 */
export function isNavigationError(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && (digest.startsWith('NEXT_REDIRECT') || digest.startsWith('NEXT_HTTP_ERROR_FALLBACK'));
}
