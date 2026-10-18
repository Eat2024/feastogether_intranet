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

export function setExternalAccessCookie(
  reply: FastifyReply,
  config: ConfigService,
  token: string,
  expiresAt: Date,
): void {
  reply.setCookie(EXTERNAL_ACCESS_COOKIE, token, {
    httpOnly: true,
    secure: secure(config),
    sameSite: 'lax',
    path: EXTERNAL_ACCESS_PATH,
    expires: expiresAt,
  });
}

export function clearExternalAccessCookie(reply: FastifyReply): void {
  reply.clearCookie(EXTERNAL_ACCESS_COOKIE, { path: EXTERNAL_ACCESS_PATH });
}
