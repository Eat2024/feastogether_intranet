/** 登入後只返回電子簽站內頁面，不接受外站、登入入口或 API。 */
export function safeLoginReturnPath(value: string | undefined): string {
  if (!value || /[\\\s#]/.test(value)) return '/forms';
  const path = value.split('?')[0];
  if (path.includes('%')) return '/forms';
  if (!/^\/(?:forms|my-signature|export-history)(?:\/|$)/.test(path))
    return '/forms';
  const url = new URL(value, 'https://esign.invalid');
  if (url.origin !== 'https://esign.invalid' || url.pathname !== path)
    return '/forms';
  return value;
}
