// dev-login.e2e-spec.ts
// DEVMOD 開發者登入 e2e（真 MySQL／Redis）：開放時以 dev-admin（ADMIN）取得可用的 session，
// 登出不打上游；未開放時入口不出現、端點 404。env 於每個案例自行設定並還原。
import request from 'supertest';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { AppModule } from '#app/app.module';
import {
  configureApp,
  registerFastifyPlugins,
} from '#app/bootstrap/app.bootstrap';
import {
  AUTH_COOKIE_NAME,
  DEV_LOGIN_EMPID,
} from '#app/features/auth/auth.constants';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import type { ApiSuccess } from './api-response.helper';

type Session = {
  user: { empId: string };
  role: { roleCode: string } | null;
};

/** 以指定 DEVMOD 建立 app、執行測試、關閉；env 於結束後還原。 */
async function withApp(
  devmod: string,
  fn: (app: NestFastifyApplication) => Promise<void>,
): Promise<void> {
  const saved = process.env.DEVMOD;
  process.env.DEVMOD = devmod;
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  configureApp(app);
  await registerFastifyPlugins(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  try {
    await fn(app);
  } finally {
    await app.close();
    process.env.DEVMOD = saved;
  }
}

const authCookieOf = (res: request.Response): string => {
  const header = res.headers['set-cookie'] as unknown as string[];
  const found = header.find((c) => c.startsWith(`${AUTH_COOKIE_NAME}=`));
  return found!.split(';')[0];
};

describe('DEVMOD 開發者登入 (e2e)', () => {
  afterAll(async () => {
    // 硬刪合成的開發者帳號（測試 DB 專用），不影響其他套件的使用者計數。
    await withApp('false', async (app) => {
      const ds = app.get<DataSource>(MYSQL_MAIN);
      await ds.query('DELETE FROM auth_users WHERE person_empid = ?', [
        DEV_LOGIN_EMPID,
      ]);
    });
  });

  it('DEVMOD=true：入口出現 → 以 dev-admin（ADMIN）登入 → /me 可用 → 登出 not_applicable', async () => {
    await withApp('true', async (app) => {
      const server = app.getHttpAdapter().getInstance().server;

      const options = await request(server)
        .get('/api/auth/login-options')
        .expect(200);
      expect(
        (options.body as ApiSuccess<{ devLogin: boolean }>).data.devLogin,
      ).toBe(true);

      const login = await request(server)
        .post('/api/auth/dev-login')
        .expect(200);
      const session = (login.body as ApiSuccess<Session>).data;
      expect(session.user.empId).toBe(DEV_LOGIN_EMPID);
      expect(session.role?.roleCode).toBe('ADMIN');
      expect(JSON.stringify(login.body)).not.toContain('accessToken');
      const cookie = authCookieOf(login);

      const me = await request(server)
        .get('/api/auth/me')
        .set('Cookie', cookie)
        .expect(200);
      expect((me.body as ApiSuccess<Session>).data.user.empId).toBe(
        DEV_LOGIN_EMPID,
      );

      const logout = await request(server)
        .post('/api/auth/logout')
        .set('Cookie', cookie)
        .expect(200);
      expect(
        (logout.body as ApiSuccess<{ upstreamLogout: string }>).data
          .upstreamLogout,
      ).toBe('not_applicable');
      await request(server)
        .get('/api/auth/me')
        .set('Cookie', cookie)
        .expect(401);
    });
  });

  it('DEVMOD=false：入口不出現、端點 404', async () => {
    await withApp('false', async (app) => {
      const server = app.getHttpAdapter().getInstance().server;

      const options = await request(server)
        .get('/api/auth/login-options')
        .expect(200);
      expect(
        (options.body as ApiSuccess<{ devLogin: boolean }>).data.devLogin,
      ).toBe(false);
      await request(server).post('/api/auth/dev-login').expect(404);
    });
  });

  it('DEVMOD 關閉後，先前簽發的開發者 session 立即失效', async () => {
    let cookie = '';
    await withApp('true', async (app) => {
      const server = app.getHttpAdapter().getInstance().server;
      const login = await request(server)
        .post('/api/auth/dev-login')
        .expect(200);
      cookie = authCookieOf(login);
    });

    await withApp('false', async (app) => {
      const server = app.getHttpAdapter().getInstance().server;
      await request(server)
        .get('/api/auth/me')
        .set('Cookie', cookie)
        .expect(401);
    });
  });
});
