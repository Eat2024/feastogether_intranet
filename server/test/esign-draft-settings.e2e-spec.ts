import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import { DataSource } from 'typeorm';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { FeastogetherHrService } from '#app/infrastructure/http-client/feastogether/services/feastogether-hr.service';
import { apiData } from './api-response.helper';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

interface DraftView {
  id: string;
  status: string;
  signStartAt: string | null;
  signEndAt: string | null;
  watermark: boolean;
  allowReject: boolean;
  signers: Array<{
    type: string;
    name: string;
    email: string | null;
    publicId: string;
  }>;
}

describe('Spec009 草稿完整設定 API', () => {
  let ctx: SecurityE2eContext;
  let db: DataSource;
  let cookie: string;
  let other: string;
  let id: string;
  let ownerId: string;
  const origin = 'http://localhost:3000';
  const patch = (body: object, auth = cookie) =>
    request(ctx.server)
      .patch(`/api/esign/documents/${id}/draft-settings`)
      .set('Cookie', auth)
      .set('Origin', origin)
      .send(body);
  const read = async () =>
    apiData<DraftView>(
      await request(ctx.server)
        .get(`/api/esign/documents/${id}`)
        .set('Cookie', cookie)
        .expect(200),
    );

  beforeAll(async () => {
    ctx = await createSecurityE2eApp((builder) =>
      builder.overrideProvider(FeastogetherHrService).useValue({
        lookupEligibleStaff: (empid: string) =>
          Promise.resolve({
            person_empid: empid,
            person_name: '草稿測試員工',
            person_status: 1,
            person_status_name: '正式',
            department_id: 'D009',
            department_name: '測試部',
            title: '測試員工',
          }),
      }),
    );
    db = ctx.app.get<DataSource>(MYSQL_MAIN);
    cookie = await login('DRAFT00901');
    other = await login('DRAFT00902');
    const users = await db.query<Array<{ id: number }>>(
      "SELECT id FROM users WHERE empid='DRAFT00901'",
    );
    ownerId = String(users[0].id);
    const pdf = await PDFDocument.create();
    pdf.addPage();
    id = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', cookie)
        .set('Origin', origin)
        .field('title', '草稿設定測試')
        .attach('file', Buffer.from(await pdf.save()), {
          filename: 'draft.pdf',
          contentType: 'application/pdf',
        })
        .expect(201),
    ).id;
  });
  afterAll(async () => {
    if (ctx) await closeSecurityE2eApp(ctx);
  });

  it('保存混合名單、單端過去日期與選項，重新登入仍可回填且不發起', async () => {
    const result = apiData<DraftView>(
      await patch({
        signers: [
          { type: 'user', userId: ownerId },
          { type: 'email', name: '外部測試', email: 'External@Example.test' },
        ],
        signStartAt: '2020-01-01T00:00:00+08:00',
        signEndAt: null,
        watermark: true,
        allowReject: true,
      }).expect(200),
    );
    expect(result).toMatchObject({
      status: 'draft',
      signStartAt: '2019-12-31T16:00:00.000Z',
      signEndAt: null,
      watermark: true,
      allowReject: true,
      signers: [
        { type: 'user' },
        { type: 'email', email: 'external@example.test' },
      ],
    });
    cookie = await login('DRAFT00901');
    expect(await read()).toEqual(result);
    const batches = await db.query<Array<{ total: string }>>(
      'SELECT COUNT(*) total FROM esign_notification_batches WHERE document_id=?',
      [id],
    );
    expect(Number(batches[0].total)).toBe(0);
  });

  it('省略保留、null 清空；舊名單 API 不清除期間或選項', async () => {
    await patch({ signEndAt: '2020-02-01T00:00:00+08:00' }).expect(200);
    const legacy = await request(ctx.server)
      .put(`/api/esign/documents/${id}/draftSave`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({
        signers: [
          { type: 'email', name: '純外部', email: 'only@example.test' },
        ],
      })
      .expect(200);
    expect(apiData<unknown[]>(legacy)).toHaveLength(1);
    expect(await read()).toMatchObject({
      signStartAt: '2019-12-31T16:00:00.000Z',
      signEndAt: '2020-01-31T16:00:00.000Z',
      watermark: true,
      allowReject: true,
    });
    await patch({ signStartAt: null }).expect(200);
    expect(await read()).toMatchObject({
      signStartAt: null,
      signEndAt: '2020-01-31T16:00:00.000Z',
    });
  });

  it.each([
    { signStartAt: 'invalid' },
    { signStartAt: '2020-02-30T00:00:00Z' },
    { signStartAt: '2020-02-01' },
    { signStartAt: '2020-03-01T00:00:00Z' },
    { watermark: null },
    { allowReject: 'true' },
    { signers: null },
    { signers: [] },
    { signers: [{ type: 'user', userId: '999999999' }] },
    {
      signers: [
        { type: 'email', name: '甲', email: 'same@example.test' },
        { type: 'email', name: '乙', email: 'SAME@example.test' },
      ],
    },
  ])('非法欄位不會部分修改名單或設定：%j', async (invalid) => {
    const before = await read();
    await patch({
      signers: [
        { type: 'email', name: '不應保存', email: 'rollback@example.test' },
      ],
      watermark: false,
      ...invalid,
    }).expect(400);
    expect(await read()).toEqual(before);
  });

  it('名單替換後寫入設定失敗時，交易回滾並保留原名單身分與日期', async () => {
    const before = await read();
    await db.query(`CREATE TRIGGER draft_settings_test_failure BEFORE UPDATE ON esign_documents FOR EACH ROW
      BEGIN IF NEW.id = ${Number(id)} AND NEW.watermark_enabled = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '合成交易失敗';
      END IF; END`);
    try {
      await patch({
        signers: [
          {
            type: 'email',
            name: '不應留下',
            email: 'transaction@example.test',
          },
        ],
        signStartAt: '2020-01-01T00:00:00Z',
        watermark: false,
      }).expect(500);
      expect(await read()).toEqual(before);
    } finally {
      await db.query('DROP TRIGGER draft_settings_test_failure');
    }
  });

  it('未登入、外部 session 與非建立人不可寫入；缺 Origin 拒絕', async () => {
    await request(ctx.server)
      .patch(`/api/esign/documents/${id}/draft-settings`)
      .set('Origin', origin)
      .send({})
      .expect(401);
    await patch({}, 'esign_external_access=invalid').expect(401);
    await patch({}, other).expect(404);
    await request(ctx.server)
      .patch(`/api/esign/documents/${id}/draft-settings`)
      .set('Cookie', cookie)
      .send({})
      .expect(403);
  });

  it('正式狀態不可修改草稿，單端期間不能直接轉成正式狀態', async () => {
    await expect(
      db.query("UPDATE esign_documents SET status='active' WHERE id=?", [id]),
    ).rejects.toThrow();
    await patch({ signStartAt: '2020-01-01T00:00:00Z' }).expect(200);
    await db.query("UPDATE esign_documents SET status='active' WHERE id=?", [
      id,
    ]);
    await patch({ watermark: false }).expect(409);
  });

  async function login(empid: string): Promise<string> {
    const launched = await request(ctx.server)
      .post('/api/auth/webview-launches')
      .set('Authorization', `Bearer ${createLaunchJwt(empid)}`)
      .expect(201);
    const code = new URL(
      apiData<{ launchUrl: string }>(launched).launchUrl,
    ).searchParams.get('code');
    const response = await request(ctx.server)
      .post('/api/auth/session')
      .type('form')
      .send({ code })
      .expect(303);
    const raw: unknown = response.headers['set-cookie'];
    const value: unknown = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string') throw new Error('缺少測試 session');
    return value;
  }
});

function createLaunchJwt(empid: string): string {
  const encoded = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = encoded({ alg: 'RS256', typ: 'FT-ESIGN-LAUNCH+JWT' });
  const payload = encoded({
    iss: 'e2e-main-platform',
    aud: 'e2e-esign',
    sub: empid,
    jti: randomUUID(),
    iat: now,
    nbf: now,
    exp: now + 120,
  });
  const privateKey = createPrivateKey(
    Buffer.from(process.env.WEBVIEW_TEST_PRIVATE_KEY_B64!, 'base64').toString(
      'utf8',
    ),
  );
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(`${header}.${payload}`),
    privateKey,
  ).toString('base64url');
  return `${header}.${payload}.${signature}`;
}
