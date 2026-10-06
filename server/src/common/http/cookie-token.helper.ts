export type CookieMap = Record<string, string | undefined> | undefined;

export function cookieTokenFromMap(
  cookies: CookieMap,
  cookieName: string,
): string | null {
  return cookies?.[cookieName] ?? null;
}

export function cookieTokenFromHeader(
  cookieHeader: string | undefined,
  cookieName: string,
): string | null {
  const prefix = `${cookieName}=`;
  const cookie = (cookieHeader ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  if (!cookie) return null;

  try {
    return decodeURIComponent(cookie.slice(prefix.length));
  } catch {
    return null;
  }
}
