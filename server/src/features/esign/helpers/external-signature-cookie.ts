import type { ConfigService } from '@nestjs/config';
import type { FastifyReply } from 'fastify';
import { AppEnvironment } from '#app/config/app.environment';

export const EXTERNAL_ACCESS_COOKIE = 'FT_ESIGN_EXTERNAL_ACCESS';
export const EXTERNAL_ACCESS_PATH = '/api/external-signing-task';

function secure(config: ConfigService): boolean {
  const environment = config.get<string>('NODE_ENV');
  return (
    environment === AppEnvironment.Staging ||
    environment === AppEnvironment.Production
  );
}

/** 值為驗證碼通過後的存取憑證；session cookie（不設期限，瀏覽器關閉即失效），伺服器端另有 8 小時期限 */
export function setExternalAccessCookie(
  reply: FastifyReply,
  config: ConfigService,
  credential: string,
): void {
  reply.setCookie(EXTERNAL_ACCESS_COOKIE, credential, {
    httpOnly: true,
    secure: secure(config),
    sameSite: 'lax',
    path: EXTERNAL_ACCESS_PATH,
  });
}

export function clearExternalAccessCookie(reply: FastifyReply): void {
  reply.clearCookie(EXTERNAL_ACCESS_COOKIE, { path: EXTERNAL_ACCESS_PATH });
}
