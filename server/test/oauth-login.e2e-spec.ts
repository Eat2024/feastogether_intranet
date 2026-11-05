import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource, In } from 'typeorm';
import { EsignDocument } from '#app/features/esign/entities/esign-document.entity';
import { User } from '#app/features/users/entities/user.entity';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { OauthClient } from '#app/infrastructure/http-client/oauth/oauth.client';
import { apiData, apiError } from './api-response.helper';
import {
  closeSecurityE2eApp,
  createSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';
import {
  createSyntheticPortal,
  type SyntheticPerson,
  type SyntheticPortal,
} from './synthetic-portal.helper';

/** 只替換上游 OIDC 網路，員工資料來自合成 Portal；正式 AuthModule、Redis 交易、MySQL session 與 guard 全部實際執行。 */
describe('OAuth 登入 HTTP 整合', () => {
  const empid = 'E2EOAUTHLOGIN';
  let userNumber = empid;
  let ctx: SecurityE2eContext;
  let db: DataSource;
  let portal: SyntheticPortal;
  const otherEmpids: string[] = [];
  const documentIds: number[] = [];

  const setStaff = (fields: Partial<SyntheticPerson>) =>
    portal.query('UPDATE sys_person SET ? WHERE person_empid = ?', [
      fields,
      empid,
    ]);

  const enter = async (expected = 200) => {
    const ip = `2001:db8:${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}::24`;
    const started = await request(ctx.server)
      .post('/api/auth/oauth/start')
      .set('Origin', 'http://localhost:3000')
      .set('X-Forwarded-For', ip)
      .send({})
      .expect(200);
    const state = new URL(
      apiData<{ authorizationUrl: string }>(started).authorizationUrl,
    ).searchParams.get('state');
    const raw: unknown = started.headers['set-cookie'];
    const tx: unknown = Array.isArray(raw) ? raw[0] : raw;
    if (typeof tx !== 'string') throw new Error('缺少交易cookie');
    return request(ctx.server)
      .post('/api/auth/oauth/callback')
      .set('Origin', 'http://localhost:3000')
      .set('X-Forwarded-For', ip)
      .set('Cookie', tx.split(';')[0])
      .send({ state, code: 'synthetic-code' })
      .expect(expected);
  };

  beforeAll(async () => {
    portal = await createSyntheticPortal();
    await portal.insertPeople([
      {
        person_empid: empid,
        person_name: '合成OAuth員工',
        person_status: 1,
        department_id: 'OA017A',
        department_name: '合成OAuth部門',
        title: '合成職稱',
      },
    ]);
    ctx = await createSecurityE2eApp((builder) =>
      builder.overrideProvider(OauthClient).useValue({
        createLoginChallenge: () => ({
          state: randomUUID(),
          nonce: randomUUID(),
        }),
        buildAuthorizationUrl: ({ state }: { state: string }) =>
          Promise.resolve(`https://auth.example.test/authorize?state=${state}`),
        exchangeCode: () =>
          Promise.resolve({
            accessToken: 'synthetic-provider-token',
            sub: 'synthetic-sub',
          }),
        fetchUserInfo: () =>
          Promise.resolve({
            sub: 'synthetic-sub',
            userNumber,
            name: '登入測試員工',
          }),
      }),
    );
    db = ctx.app.get<DataSource>(MYSQL_MAIN);
  });

  afterEach(() => {
    userNumber = empid;
  });

  afterAll(async () => {
    if (ctx) {
      if (documentIds.length)
        await db.manager.delete(EsignDocument, { id: In(documentIds) });
      const empids = [empid, ...otherEmpids];
      // 安全事件與替換連結以 FK 指向會話／員工：先刪事件、解除連結，再刪會話與員工。
      const users = 'SELECT id FROM users WHERE empid IN (?)';
      await db.query(
        `DELETE FROM auth_security_events WHERE actor_user_id IN (${users})`,
        [empids],
      );
      await db.query(
        `UPDATE auth_sessions SET replacement_session_id = NULL WHERE user_id IN (${users})`,
        [empids],
      );
      await db.query(`DELETE FROM auth_sessions WHERE user_id IN (${users})`, [
        empids,
      ]);
      await db.query('DELETE FROM users WHERE empid IN (?)', [empids]);
      await closeSecurityE2eApp(ctx);
    }
    await portal?.drop();
  });

  it('登入、瀏覽器綁定、重放拒絕與 session 到期', async () => {
    const started = await request(ctx.server)
      .post('/api/auth/oauth/start')
      .set('Origin', 'http://localhost:3000')
      .send({ redirectTo: '/forms/42' })
      .expect(200);
    const state = new URL(
      apiData<{ authorizationUrl: string }>(started).authorizationUrl,
    ).searchParams.get('state');
    const rawCookies: unknown = started.headers['set-cookie'];
    if (!Array.isArray(rawCookies) || typeof rawCookies[0] !== 'string')
      throw new Error('缺少交易 cookie');
    const txCookie = rawCookies[0].split(';')[0];
    expect(txCookie).toMatch(/^FT_ESIGN_OAUTH_TX=/);
    const callback = { state, code: 'synthetic-code' };
    await request(ctx.server)
      .post('/api/auth/oauth/callback')
      .set('Origin', 'http://localhost:3000')
      .send(callback)
      .expect(400);
    const completed = await request(ctx.server)
      .post('/api/auth/oauth/callback')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', txCookie)
      .send(callback)
      .expect(200);
    expect(apiData<{ redirectTo: string }>(completed).redirectTo).toBe(
      '/forms/42',
    );
    expect(completed.text).not.toContain('synthetic-provider-token');
    const cookies: unknown = completed.headers['set-cookie'];
    if (!Array.isArray(cookies)) throw new Error('缺少登入 cookie');
    const cookie: unknown = cookies.find(
      (value: unknown) =>
        typeof value === 'string' && value.startsWith('FT_ESIGN_SESSION='),
    );
    if (typeof cookie !== 'string') throw new Error('缺少登入 cookie');
    expect(cookie).toContain('HttpOnly');
    // 交易 cookie 以寫入時的屬性清除。
    expect(
      cookies.find(
        (value: unknown) =>
          typeof value === 'string' && value.startsWith('FT_ESIGN_OAUTH_TX=;'),
      ),
    ).toEqual(
      expect.stringMatching(/Max-Age=0.*Path=\/.*HttpOnly.*SameSite=Lax/),
    );
    await request(ctx.server)
      .get('/api/auth/session')
      .set('Cookie', cookie.split(';')[0])
      .expect(200);
    const [row] = await db.query<Array<{ id: number; source: string }>>(
      'SELECT id, source FROM auth_sessions WHERE session_token_hash = SHA2(?, 256)',
      [cookie.split(';')[0].split('=')[1]],
    );
    expect(row.source).toBe('oauth');
    expect(
      await db.query(
        'SELECT event_type, outcome_code FROM auth_security_events WHERE session_id = ?',
        [row.id],
      ),
    ).toEqual([{ event_type: 'login.succeeded', outcome_code: 'succeeded' }]);
    await request(ctx.server)
      .post('/api/auth/oauth/callback')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', txCookie)
      .send(callback)
      .expect(400);
    await db.query(
      'UPDATE auth_sessions SET expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE user_id = (SELECT id FROM users WHERE empid = ?)',
      [empid],
    );
    await request(ctx.server)
      .get('/api/auth/session')
      .set('Cookie', cookie.split(';')[0])
      .expect(401);
  });

  it('OAuth 依已驗證員編查 Portal 可信部門；調職與缺值同步立即影響舊session，Portal 失敗不發session', async () => {
    const original = await enter();
    const raw: unknown = original.headers['set-cookie'];
    if (!Array.isArray(raw)) throw new Error('缺少登入cookie');
    const cookie: unknown = raw.find(
      (value: unknown) =>
        typeof value === 'string' && value.startsWith('FT_ESIGN_SESSION='),
    );
    if (typeof cookie !== 'string') throw new Error('缺少登入cookie');
    const user = await db.manager.findOneByOrFail(User, { empid });
    expect(user.departmentCode).toBe('OA017A');
    const docs = await db.manager.save(
      EsignDocument,
      ['OA017A', 'OA017B'].map((code) =>
        db.manager.create(EsignDocument, {
          docNumber: randomUUID(),
          title: '合成OAuth部門文件',
          status: 'draft',
          createdByUserId: user.id,
          createdByDepartmentCode: code,
        }),
      ),
    );
    documentIds.push(...docs.map((doc) => doc.id));
    const visible = () =>
      request(ctx.server)
        .get('/api/esign/documents?role=dep')
        .set('Cookie', cookie.split(';')[0]);
    expect(
      apiData<Array<{ id: string }>>(await visible().expect(200)).map(
        (doc) => doc.id,
      ),
    ).toEqual([String(docs[0].id)]);
    await setStaff({ department_id: 'OA017B' });
    await enter();
    expect(
      apiData<Array<{ id: string }>>(await visible().expect(200)).map(
        (doc) => doc.id,
      ),
    ).toEqual([String(docs[1].id)]);
    const before = await db.query<Array<{ total: number }>>(
      'SELECT COUNT(*) total FROM auth_sessions WHERE user_id=?',
      [user.id],
    );
    await portal.query('RENAME TABLE sys_person TO sys_person_revoked');
    let failed: request.Response;
    try {
      failed = await enter(502);
    } finally {
      await portal.query('RENAME TABLE sys_person_revoked TO sys_person');
    }
    expect(apiError(failed)).toEqual({
      code: 'STAFF_LOOKUP_FAILED',
      message: '系統有錯，請詢問IT部門',
    });
    expect(String(failed.headers['set-cookie'] ?? '')).not.toContain(
      'FT_ESIGN_SESSION=',
    );
    expect(
      await db.query(
        'SELECT COUNT(*) total FROM auth_sessions WHERE user_id=?',
        [user.id],
      ),
    ).toEqual(before);
    expect(
      (await db.manager.findOneByOrFail(User, { id: user.id })).departmentCode,
    ).toBe('OA017B');
    await setStaff({ department_id: '', department_name: '' });
    await enter();
    expect(
      await db.manager.findOneByOrFail(User, { id: user.id }),
    ).toMatchObject({ departmentCode: null, departmentName: null });
    await visible().expect(409);
    await request(ctx.server)
      .get('/api/auth/session')
      .set('Cookie', cookie.split(';')[0])
      .expect(200);
  });

  it('今天才進 Portal 的新進同仁可立即登入；OAuth 只寫部門，不寫人員狀態與職稱', async () => {
    userNumber = 'E2EOANEW';
    otherEmpids.push(userNumber);
    await portal.insertPeople([
      {
        person_empid: userNumber,
        person_name: '合成新進',
        person_status: 0,
        department_id: 'OA024N',
        department_name: '合成新進部門',
        title: '合成職稱',
      },
    ]);
    await enter();
    expect(
      await db.manager.findOneByOrFail(User, { empid: userNumber }),
    ).toMatchObject({
      name: '登入測試員工',
      departmentCode: 'OA024N',
      departmentName: '合成新進部門',
      departmentId: null,
      personStatus: null,
      titleName: null,
    });
  });

  it.each<{ case: string; empid: string; rows: SyntheticPerson[] }>([
    { case: '查無', empid: 'E2EOANONE', rows: [] },
    {
      case: '同員編兩筆在職',
      empid: 'E2EOADUP',
      rows: [
        { person_empid: 'E2EOADUP', person_name: '合成甲', person_status: 1 },
        { person_empid: 'E2EOADUP', person_name: '合成乙', person_status: 1 },
      ],
    },
    {
      case: 'Portal 已非在職',
      empid: 'E2EOALEFT',
      rows: [
        {
          person_empid: 'E2EOALEFT',
          person_name: '合成離職',
          person_status: 3,
        },
      ],
    },
    {
      case: '員編只差大小寫',
      empid: 'E2EOACASE',
      rows: [
        {
          person_empid: 'e2eoacase',
          person_name: '合成小寫',
          person_status: 1,
        },
      ],
    },
    {
      case: '部門代碼含非法字元',
      empid: 'E2EOABADDEP',
      rows: [
        {
          person_empid: 'E2EOABADDEP',
          person_name: '合成部門',
          person_status: 1,
          department_id: 'D/01',
        },
      ],
    },
  ])(
    '$case：回 AUTH_EXCHANGE_FAILED，不建立帳號也不發 session',
    async ({ empid: rejected, rows }) => {
      userNumber = rejected;
      otherEmpids.push(rejected);
      await portal.insertPeople(rows);
      const response = await enter(401);
      expect(apiError(response)).toEqual({
        code: 'AUTH_EXCHANGE_FAILED',
        message: '無法完成登入交換',
      });
      expect(String(response.headers['set-cookie'] ?? '')).not.toContain(
        'FT_ESIGN_SESSION=',
      );
      expect(await db.manager.countBy(User, { empid: rejected })).toBe(0);
    },
  );

  it('跨站發起登入會被拒絕', async () => {
    await request(ctx.server)
      .post('/api/auth/oauth/start')
      .set('Origin', 'https://evil.test')
      .send({})
      .expect(403);
  });
});
