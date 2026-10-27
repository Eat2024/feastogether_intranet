import type { CookieSerializeOptions } from '@fastify/cookie';
import type { ConfigService } from '@nestjs/config';
import type { FastifyReply } from 'fastify';
import { AppEnvironment } from '#app/config/app.environment';
import {
  AUTH_COOKIE_NAME,
  OAUTH_TX_COOKIE_NAME,
  OAUTH_TX_TTL_SECONDS,
  WEBVIEW_SESSION_TTL_SECONDS,
} from '#app/features/auth/auth.constants';

/** 公開 HTTPS 環境（production／staging）一律 Secure；本機 http 開發不加。 */
function isSecureEnvironment(config: ConfigService): boolean {
  const env = config.get<string>('NODE_ENV');
  return env === AppEnvironment.Production || env === AppEnvironment.Staging;
}

/** 兩把 cookie 共用的安全屬性：HttpOnly、SameSite=Lax、host-only、Path=/。 */
function baseCookieOptions(config: ConfigService): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: isSecureEnvironment(config),
    sameSite: 'lax',
    path: '/',
  };
}

/**
 * 登入 cookie 的屬性。主平台（http 入口網）以 iframe 嵌入電子簽時，依 schemeful same-site 屬跨站，
 * SameSite=Lax 的 cookie 在 iframe 內寫不進也帶不出去，因此 HTTPS 環境改用 SameSite=None（須搭配 Secure）；
 * 跨站的異動請求改由 OriginGuard 擋下。本機 http 開發不能用 None，維持 Lax。
 */
function authCookieOptions(config: ConfigService): CookieSerializeOptions {
  const options = baseCookieOptions(config);
  return options.secure ? { ...options, sameSite: 'none' } : options;
}

/** 寫入 WebView 本地 session cookie；固定 8 小時且不滑動。 */
export function setAuthCookie(
  reply: FastifyReply,
  config: ConfigService,
  token: string,
): void {
  reply.setCookie(AUTH_COOKIE_NAME, token, {
    ...authCookieOptions(config),
    maxAge: WEBVIEW_SESSION_TTL_SECONDS,
  });
}

/** 寫入 OAuth 登入交易的瀏覽器綁定 cookie；壽命同交易 TTL。 */
export function setOauthTxCookie(
  reply: FastifyReply,
  config: ConfigService,
  value: string,
): void {
  reply.setCookie(OAUTH_TX_COOKIE_NAME, value, {
    ...baseCookieOptions(config),
    maxAge: OAUTH_TX_TTL_SECONDS,
  });
}

/** 清除登入 cookie（登出、改密碼、登入失敗共用；屬性須與寫入時一致，iframe 內的跨站回應才清得掉）。 */
export function clearAuthCookie(
  reply: FastifyReply,
  config: ConfigService,
): void {
  reply.clearCookie(AUTH_COOKIE_NAME, authCookieOptions(config));
}

/** 清除交易 cookie（回呼完成或登出時；使尚未完成的登入交易無法再回呼）。 */
export function clearOauthTxCookie(reply: FastifyReply): void {
  reply.clearCookie(OAUTH_TX_COOKIE_NAME, { path: '/' });
}
