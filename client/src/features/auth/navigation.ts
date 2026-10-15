/** 僅允許返回員工頁面，避免外站導向或重新進入登入流程。 */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || /[\\\s#]/.test(value)) return '/forms';
  const path = value.split('?')[0];
  if (path.includes('%')) return '/forms';
  if (!/^\/(?:forms|my-signature|export-history)(?:\/|$)/.test(path)) return '/forms';
  const url = new URL(value, 'https://esign.invalid');
  if (url.origin !== 'https://esign.invalid' || url.pathname !== path) return '/forms';
  return value;
}

export function loginHref(returnTo?: string | null, expired = true): string {
  const params = new URLSearchParams({ redirectTo: safeReturnPath(returnTo) });
  if (expired) params.set('expired', '1');
  return `/login?${params}`;
}

/** 僅由員工 API 呼叫；外部簽署的 401 代表邀請失效，不應導向員工登入。 */
export function redirectExpiredSession(response: Response): boolean {
  if (response.status !== 401) return false;
  window.location.replace(loginHref(window.location.pathname + window.location.search));
  return true;
}
