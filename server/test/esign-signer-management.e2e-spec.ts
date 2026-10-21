import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import { DataSource } from 'typeorm';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { FeastogetherHrService } from '#app/infrastructure/http-client/feastogether/services/feastogether-hr.service';
import { apiData } from './api-response.helper';
import { openInternalEmailSession } from './external-session.helper';
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
    note: string;
  }>;
}

describe('Spec009 管理備註與歷程 API', () => {
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
        getStaffEmails: syntheticStaffEmails,
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
    cookie = await login('NOTE00901');
    other = await login('NOTE00902');
    const users = await db.query<Array<{ id: number }>>(
      "SELECT id FROM users WHERE empid='NOTE00901'",
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

  it('建立人保存並重新讀取永久備註', async () => {
    await patch({
      signers: [
        { type: 'email', name: '外部測試', email: 'note@example.test' },
      ],
    }).expect(200);
    const signer = (await read()).signers[0];
    await request(ctx.server)
      .patch(`/api/esign/documents/${id}/signers/${signer.publicId}/note`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({ note: '  已聯繫 😀  ' })
      .expect(200);
    expect((await read()).signers[0].note).toBe('已聯繫 😀');
  });

  it('備註清空、30 emoji、越權、無 Origin 與錯誤值皆保持正確結果', async () => {
    const signer = (await read()).signers[0];
    const url = `/api/esign/documents/${id}/signers/${signer.publicId}/note`;
    const save = (note: unknown, auth = cookie) =>
      request(ctx.server)
        .patch(url)
        .set('Cookie', auth)
        .set('Origin', origin)
        .send({ note });
    await save(' 😀'.trim().repeat(30)).expect(200);
    for (const note of [null, 1, {}, '😀'.repeat(31)])
      await save(note).expect(400);
    await save('別人修改', other).expect(404);
    await save('外部修改', 'esign_external_access=invalid').expect(401);
    await request(ctx.server)
      .patch(url)
      .set('Origin', origin)
      .send({ note: '未登入' })
      .expect(401);
    await request(ctx.server)
      .patch(url)
      .set('Cookie', cookie)
      .send({ note: '無來源' })
      .expect(403);
    await request(ctx.server)
      .patch(`/api/esign/documents/${id}/signers/${randomUUID()}/note`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({ note: '無對象' })
      .expect(404);
    expect((await read()).signers[0].note).toBe('😀'.repeat(30));
    await save('   ').expect(200);
    expect((await read()).signers[0].note).toBe('');
  });

  it('停止與完成仍可存備註且不改文件、audit 或來源 PDF', async () => {
    const signer = (await read()).signers[0];
    const url = `/api/esign/documents/${id}/signers/${signer.publicId}/note`;
    for (const status of ['stopped', 'completed']) {
      await db.query(
        "UPDATE esign_documents SET status=?,sign_start_at='2026-01-01',sign_end_at='2099-01-01' WHERE id=?",
        [status, id],
      );
      const before = await db.query<Record<string, unknown>[]>(
        'SELECT * FROM esign_documents WHERE id=?',
        [id],
      );
      const history = apiData<unknown[]>(
        await request(ctx.server)
          .get(`/api/esign/documents/${id}/history`)
          .set('Cookie', cookie)
          .expect(200),
      );
      const pdf = await request(ctx.server)
        .get(`/api/esign/documents/${id}/source-file`)
        .set('Cookie', cookie)
        .expect(200);
      await request(ctx.server)
        .patch(url)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send({ note: status })
        .expect(200);
      expect((await read()).signers[0].note).toBe(status);
      expect(
        await db.query('SELECT * FROM esign_documents WHERE id=?', [id]),
      ).toEqual(before);
      expect(
        apiData<unknown[]>(
          await request(ctx.server)
            .get(`/api/esign/documents/${id}/history`)
            .set('Cookie', cookie)
            .expect(200),
        ),
      ).toEqual(history);
      expect(
        (
          await request(ctx.server)
            .get(`/api/esign/documents/${id}/source-file`)
            .set('Cookie', cookie)
            .expect(200)
        ).body,
      ).toEqual(pdf.body);
    }
  });

  it('拒簽歷程辨識本人，管理備註不出現在本人任務，系統事件不誤認為簽署人', async () => {
    // 建立歷程測試用文件，操作都由公開 API 產生。
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const newId = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', cookie)
        .set('Origin', origin)
        .field('title', '歷程辨識')
        .attach('file', Buffer.from(await pdf.save()), {
          filename: 'history.pdf',
          contentType: 'application/pdf',
        })
        .expect(201),
    ).id;
    const users = await db.query<Array<{ id: number }>>(
      "SELECT id FROM users WHERE empid='NOTE00902'",
    );
    const detail = apiData<DraftView>(
      await request(ctx.server)
        .post(`/api/esign/documents/${newId}/initiations`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send({
          signers: [
            { type: 'user', userId: String(users[0].id) },
            { type: 'user', userId: ownerId },
          ],
          fields: [
            {
              type: 'signature',
              page: 1,
              xPercent: 10,
              yPercent: 10,
              widthPercent: 20,
              heightPercent: 10,
              sortOrder: 0,
            },
          ],
          signStartAt: '2026-01-01T00:00:00Z',
          signEndAt: '2099-01-01T00:00:00Z',
          watermark: false,
          allowReject: true,
        })
        .expect(201),
    );
    const signer = detail.signers[0];
    await request(ctx.server)
      .patch(`/api/esign/documents/${id}/signers/${signer.publicId}/note`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({ note: '不同文件不可修改' })
      .expect(404);

    await request(ctx.server)
      .patch(`/api/esign/documents/${newId}/signers/${signer.publicId}/note`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({ note: '僅管理可見' })
      .expect(200);
    const emailCookie = await openInternalEmailSession(ctx, signer.publicId);
    await request(ctx.server)
      .post(`/api/esign/signing-tasks/${signer.publicId}`)
      .set('Cookie', other)
      .set('Origin', origin)
      .send({})
      .expect(403);
    const task = apiData<{ signer: Record<string, unknown> }>(
      await request(ctx.server)
        .post('/api/external-signing-task')
        .set('Cookie', emailCookie)
        .set('Origin', origin)
        .send({})
        .expect(200),
    );
    expect(task.signer).not.toHaveProperty('note');
    const result = apiData<{ rejectedAt: string }>(
      await request(ctx.server)
        .post('/api/external-signing-task/rejection')
        .set('Cookie', emailCookie)
        .set('Origin', origin)
        .send({
          signerPublicId: signer.publicId,
          requestId: randomUUID(),
          reason: '不接受',
        })
        .expect(201),
    );
    const current = apiData<{
      signers: Array<{ rejectedAt: string; rejectReason: string }>;
    }>(
      await request(ctx.server)
        .get(`/api/esign/documents/${newId}`)
        .set('Cookie', cookie)
        .expect(200),
    );
    expect(current.signers[0]).toMatchObject({
      rejectedAt: result.rejectedAt,
      rejectReason: '不接受',
    });
    const history = apiData<
      Array<{ type: string; actor: unknown; reason: string }>
    >(
      await request(ctx.server)
        .get(`/api/esign/documents/${newId}/history`)
        .set('Cookie', cookie)
        .expect(200),
    );
    expect(history.find((e) => e.type === 'signer.rejected')).toMatchObject({
      reason: '不接受',
      actor: {
        kind: 'signer',
        name: '草稿測試員工',
        signerPublicId: signer.publicId,
      },
    });
    expect(history.find((e) => e.type === 'signer.assigned')).toMatchObject({
      actor: { kind: 'employee', name: '草稿測試員工' },
    });
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
import { syntheticStaffEmails } from './synthetic-staff-emails.helper';
