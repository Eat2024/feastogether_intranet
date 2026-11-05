import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import {
  closeSecurityE2eApp,
  createSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

/**
 * 員工只能經 OAuth 或 WebView 登入（027-05）：一般員工帳密登入與開發替代入口已移除，
 * 舊路徑即使帶合法 Origin 與帳密格式也回 404，不設 cookie。
 */
describe('員工帳密登入已移除', () => {
  let ctx: SecurityE2eContext;

  beforeAll(async () => {
    ctx = await createSecurityE2eApp();
  });

  afterAll(async () => closeSecurityE2eApp(ctx));

  it.each(['/api/auth/login', '/auth/login', '/api/auth/dev-login'])(
    'POST %s 回 404 且不設 cookie',
    async (path) => {
      const response = await request(ctx.server)
        .post(path)
        .set('Origin', 'http://localhost:3000')
        .send({ empId: '00123', password: 'synthetic-password' })
        .expect(404);
      expect(String(response.headers['set-cookie'] ?? '')).not.toContain(
        `${AUTH_COOKIE_NAME}=`,
      );
    },
  );

  it('Swagger 的 /api/auth 路由只剩 OAuth、WebView、目前會話與 Super user 入口', () => {
    const { paths } = SwaggerModule.createDocument(
      ctx.app,
      new DocumentBuilder().build(),
    );
    const routes = Object.entries(paths)
      .filter(([path]) => path.startsWith('/api/auth/'))
      .flatMap(([path, operations]) =>
        ['get', 'post', 'put', 'patch', 'delete']
          .filter((method) => method in operations)
          .map((method) => `${method.toUpperCase()} ${path}`),
      )
      .sort();
    expect(routes).toEqual(
      [
        'POST /api/auth/oauth/start',
        'POST /api/auth/oauth/callback',
        'POST /api/auth/webview-launches',
        'GET /api/auth/embed-origins',
        'GET /api/auth/webview',
        'POST /api/auth/session',
        'GET /api/auth/session',
        'DELETE /api/auth/session',
        'GET /api/auth/super-user-entries/{entryKey}',
        'POST /api/auth/super-user-entries/{entryKey}/sessions',
      ].sort(),
    );
  });
});
