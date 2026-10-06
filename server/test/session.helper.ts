import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  AUTH_COOKIE_NAME,
  SESSION_SOURCE,
} from '#app/features/auth/auth.constants';
import { AuthSessionService } from '#app/features/auth/services/auth-session.service';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import type { E2eServer } from './api-response.helper';

/**
 * 為 global-setup 以 seed:rbac 建立的超級管理員（SUPER_ADMIN_EMPID，綁 ADMIN）
 * 簽發真的 session（走 AuthSessionService，與正式登入同格式），回傳 Cookie 字串。
 * 認證一律強制，e2e 以此身分呼叫受保護端點。
 */
export async function issueSuperAdminCookie(
  app: INestApplication,
): Promise<string> {
  const empid = process.env.SUPER_ADMIN_EMPID;
  const ds = app.get<DataSource>(MYSQL_MAIN);
  const [user] = await ds.query<Array<{ id: number }>>(
    'SELECT id FROM auth_users WHERE person_empid = ? LIMIT 1',
    [empid],
  );
  if (!user) {
    throw new Error(
      `找不到超級管理員（SUPER_ADMIN_EMPID=${empid}），請確認 seed`,
    );
  }
  const sessions = app.get(AuthSessionService, { strict: false });
  const token = await sessions.issue(Number(user.id), {
    source: SESSION_SOURCE.OAUTH,
    encryptedRefreshToken: null,
  });
  return `${AUTH_COOKIE_NAME}=${token}`;
}

/** 每個請求自動帶上指定 session cookie 的 supertest 包裝。 */
export function authedRequest(server: E2eServer, cookie: string) {
  return {
    get: (url: string) => request(server).get(url).set('Cookie', cookie),
    post: (url: string) => request(server).post(url).set('Cookie', cookie),
    put: (url: string) => request(server).put(url).set('Cookie', cookie),
    patch: (url: string) => request(server).patch(url).set('Cookie', cookie),
    delete: (url: string) => request(server).delete(url).set('Cookie', cookie),
  };
}

export type AuthedRequest = ReturnType<typeof authedRequest>;
