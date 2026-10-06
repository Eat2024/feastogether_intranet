import type { CookieSerializeOptions } from '@fastify/cookie';
import type { ConfigService } from '@nestjs/config';
import type { FastifyReply } from 'fastify';
import { AppEnvironment } from '#app/config/app.environment';
import {
  AUTH_COOKIE_NAME,
  AUTH_TOKEN_TTL_SECONDS,
  OAUTH_TX_COOKIE_NAME,
  OAUTH_TX_TTL_SECONDS,
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

/** 寫入登入 cookie；Max-Age 與 JWT／Redis TTL 對齊（固定 24 小時）。 */
export function setAuthCookie(
  reply: FastifyReply,
  config: ConfigService,
  token: string,
): void {
  reply.setCookie(AUTH_COOKIE_NAME, token, {
    ...baseCookieOptions(config),
    maxAge: AUTH_TOKEN_TTL_SECONDS,
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

/** 清除登入 cookie（登出、改密碼、登入失敗共用；屬性須與寫入時一致）。 */
export function clearAuthCookie(reply: FastifyReply): void {
  reply.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
}

/** 清除交易 cookie（回呼完成或登出時；使尚未完成的登入交易無法再回呼）。 */
export function clearOauthTxCookie(reply: FastifyReply): void {
  reply.clearCookie(OAUTH_TX_COOKIE_NAME, { path: '/' });
}
