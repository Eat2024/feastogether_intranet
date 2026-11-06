import { createHash, randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import { AuthSessionRepository } from '#app/features/auth/repositories/auth-session.repository';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

/**
 * 業務 e2e 的員工登入前置：直接建立 8 小時 active 會話列並回 cookie 字串。
 * 不經登入入口、不寫安全事件，既有清理順序（先會話、再員工）不受影響；
 * 登入、替換與事件行為由 auth 相關 e2e 驗證。
 */
export async function employeeSessionCookie(
  app: INestApplication,
  userId: number,
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  await app.get(MysqlService).transaction((manager) =>
    app.get(AuthSessionRepository).createActive(
      {
        actorKind: 'employee',
        userId: Number(userId),
        source: 'webview',
        credentialGeneration: null,
        sourceJtiHash: sha256(`e2e\0${randomBytes(32).toString('hex')}`),
        sessionTokenHash: sha256(token),
        activatedAt: now,
        expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000),
      },
      manager,
    ),
  );
  return `${AUTH_COOKIE_NAME}=${token}`;
}
