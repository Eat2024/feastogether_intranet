/** 登入後只返回電子簽站內頁面，不接受外站、登入入口或 API。 */
export function safeLoginReturnPath(value: string | undefined): string {
  if (!value || /[\\\s#]/.test(value)) return '/esign/forms';
  const path = value.split('?')[0];
  if (path.includes('%')) return '/esign/forms';
  if (!/^\/esign\/(?:forms|my-signature|export-history)(?:\/|$)/.test(path))
    return '/esign/forms';
  const url = new URL(value, 'https://esign.invalid');
  if (url.origin !== 'https://esign.invalid' || url.pathname !== path)
    return '/esign/forms';
  return value;
}
