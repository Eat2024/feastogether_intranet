import { HttpService } from '@nestjs/axios';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { of } from 'rxjs';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { AuthSession } from '#app/features/auth/entities/auth-session.entity';
import { AuthService } from '#app/features/auth/services/auth.service';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import { User } from '#app/features/users/entities/user.entity';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { SignerRepository } from '#app/features/esign/repositories/signer.repository';
import { EsignSigner } from '#app/features/esign/entities/esign-signer.entity';
import { EsignDocument } from '#app/features/esign/entities/esign-document.entity';
import { EsignSignatureRecord } from '#app/features/esign/entities/esign-signature-record.entity';
import { EsignAuditEvent } from '#app/features/esign/entities/esign-audit-event.entity';
import { EsignFileObject } from '#app/features/esign/entities/esign-file-object.entity';
import { apiData } from './api-response.helper';
import { esignTestPng } from './esign-test-png';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

describe('Spec016 員工 session 本人簽署', () => {
  let ctx: SecurityE2eContext;
  let users: User[];
  let cookies: string[];
  const origin = 'http://localhost:3000';
  const http = {
    get: jest.fn(),
    post: (_url: string, body: { person_empids: string[] }) =>
      of({
        data: {
          success: true,
          data: body.person_empids.map((person_empid) => ({
            person_empid,
            email: 'shared@example.test',
          })),
        },
      }),
  };
  beforeAll(async () => {
    ctx = await createSecurityE2eApp((builder) =>
      builder.overrideProvider(HttpService).useValue(http),
    );
    const manager = ctx.app.get(MysqlService).getManager();
    const prefix = randomBytes(5).toString('hex');
    users = await manager.save(
      User,
      [0, 1, 2].map((index) =>
        manager.create(User, {
          empid: `S${prefix}${index}`,
          name: `合成人員${index}`,
          isActive: true,
        }),
      ),
    );
    cookies = await Promise.all(
      users.map(
        async (user) =>
          `${AUTH_COOKIE_NAME}=${(await ctx.app.get(AuthService).issueSession(user.id)).token}`,
      ),
    );
  });
  afterAll(async () => {
    if (ctx) await closeSecurityE2eApp(ctx);
  });
  async function fixture() {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const created = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', cookies[0])
        .set('Origin', origin)
        .field('title', '合成內部驗證文件')
        .attach('file', Buffer.from(await pdf.save()), {
          filename: 'test.pdf',
          contentType: 'application/pdf',
        })
        .expect(201),
    );
    const document = apiData<{
      id: string;
      signers: Array<{ publicId: string }>;
      fields: Array<{ id: string }>;
    }>(
      await request(ctx.server)
        .post(`/api/esign/documents/${created.id}/initiations`)
        .set('Cookie', cookies[0])
        .set('Origin', origin)
        .send({
          signers: users
            .slice(0, 2)
            .map((user) => ({ type: 'user', userId: String(user.id) })),
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
          signStartAt: new Date(Date.now() - 60000).toISOString(),
          signEndAt: new Date(Date.now() + 86400000).toISOString(),
          watermark: false,
          allowReject: true,
        })
        .expect(201),
    );
    const signers = await Promise.all(
      document.signers.map((signer) =>
        ctx.app
          .get(SignerRepository)
          .findByPublicId(
            signer.publicId,
            ctx.app.get(MysqlService).getManager(),
          ),
      ),
    );
    return { document, signers };
  }
  const manager = () => ctx.app.get(MysqlService).getManager();
  const path = (id: string) => `/api/esign/signing-tasks/${id}`;
  const post = (url: string, body: object = {}, cookie = cookies[0]) =>
    request(ctx.server)
      .post(url)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send(body);
  async function bodyFor(publicId: string) {
    const task = apiData<{
      consent: { version: string };
      fields: Array<{ id: string }>;
    }>(await post(path(publicId)).expect(201));
    return {
      requestId: randomUUID(),
      consentVersion: task.consent.version,
      accepted: true,
      signatures: task.fields.map((f) => ({
        fieldId: f.id,
        pngDataUrl: `data:image/png;base64,${esignTestPng(10).toString('base64')}`,
      })),
    };
  }
  it('本人無 Email／邀請仍可讀檔及簽署；匿名、過期 session、跨人與外部指派不可存取', async () => {
    const f = await fixture();
    const signer = f.signers[0]!;
    const id = signer.publicId;
    // 模擬既有無可用信箱及邀請的內部指派，發起時無 Email 的改動由 ticket08 覆蓋。
    await manager().update(EsignSigner, signer.id, {
      email: null,
      invitationTokenSha256: null,
      invitationTokenCiphertext: null,
      invitationExpiresAt: null,
    });
    await request(ctx.server).post(path(id)).set('Origin', origin).expect(401);
    await post(path(id), {}, `${AUTH_COOKIE_NAME}=expired`).expect(401);
    const expired = await ctx.app.get(AuthService).issueSession(users[0].id);
    await manager().update(
      AuthSession,
      {
        sessionTokenHash: createHash('sha256')
          .update(expired.token)
          .digest('hex'),
      },
      { expiresAt: new Date(Date.now() - 1000) },
    );
    await post(path(id), {}, `${AUTH_COOKIE_NAME}=${expired.token}`).expect(
      401,
    );
    await post(path(id), {}, cookies[2]).expect(404);
    await request(ctx.server)
      .get(path(id) + '/source-file')
      .set('Cookie', cookies[2])
      .expect(404);
    const body = await bodyFor(id);
    const before = await manager().count(EsignAuditEvent, {
      where: { signerId: signer.id, eventType: 'document.opened' },
    });
    const source = await request(ctx.server)
      .get(path(id) + '/source-file')
      .set('Cookie', cookies[0])
      .expect(200);
    expect(source.headers['content-type']).toContain('application/pdf');
    expect(source.headers['cache-control']).toBe('private, no-store');
    expect(source.headers['x-content-type-options']).toBe('nosniff');
    expect(
      await manager().count(EsignAuditEvent, {
        where: { signerId: signer.id, eventType: 'document.opened' },
      }),
    ).toBe(before);
    await post(path(id) + '/signatures', body, cookies[2]).expect(404);
    await request(ctx.server)
      .post(path(id) + '/signatures')
      .set('Cookie', cookies[0])
      .set('Origin', 'https://evil.example.test')
      .send(body)
      .expect(403);
    await post(path(id) + '/signatures', body).expect(201);
    const record = await manager().findOneByOrFail(EsignSignatureRecord, {
      signerId: signer.id,
    });
    expect(record.authenticationMethod).toBe('internal_session');
    expect(record.authenticationEventId).toBe(
      `internal:${id}:${body.requestId}`,
    );
    // 簽完後到期仍可取得同一次成功結果，不能以新 requestId 重簽。
    await manager().update(EsignDocument, Number(f.document.id), {
      status: 'stopped',
    });
    await post(path(id) + '/signatures', body).expect(200);
    await post(path(id) + '/signatures', {
      ...body,
      requestId: randomUUID(),
    }).expect(409);
    await post(path(id) + '/signatures', body, cookies[2]).expect(404);
    expect(
      await manager().findOneByOrFail(EsignSignatureRecord, {
        signerId: signer.id,
      }),
    ).toEqual(record);
    const listed = apiData<
      Array<{ signerPublicId: string; signer: { status: string } }>
    >(
      await request(ctx.server)
        .get('/api/esign/signing-tasks')
        .set('Cookie', cookies[0])
        .expect(200),
    );
    expect(listed.find((t) => t.signerPublicId === id)?.signer.status).toBe(
      'signed',
    );
    await manager().update(EsignSigner, f.signers[1]!.id, {
      signerType: 'email',
      userId: null,
      empidSnapshot: null,
    });
    await post(path(f.signers[1]!.publicId), {}, cookies[1]).expect(404);
  });
  it('同一 requestId 併發只建立一筆證據；不同 requestId 不可再簽', async () => {
    const f = await fixture();
    const id = f.signers[0]!.publicId;
    const body = await bodyFor(id);
    const responses = await Promise.all([
      post(path(id) + '/signatures', body),
      post(path(id) + '/signatures', body),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(
      apiData<{ verificationUrl: string }>(responses[0]).verificationUrl,
    ).toBe(apiData<{ verificationUrl: string }>(responses[1]).verificationUrl);
    expect(
      await manager().count(EsignSignatureRecord, {
        where: { signerId: f.signers[0]!.id },
      }),
    ).toBe(1);
    await post(path(id) + '/signatures', {
      ...body,
      requestId: randomUUID(),
    }).expect(409);
  });
  it('聲明、欄位、PNG 與 payload/source 完整性錯誤不建立簽署', async () => {
    const f = await fixture();
    const id = f.signers[0]!.publicId;
    const body = await bodyFor(id);
    await post(path(id) + '/signatures', {
      ...body,
      consentVersion: 'wrong',
    }).expect(400);
    await post(path(id) + '/signatures', { ...body, accepted: false }).expect(
      400,
    );
    await post(path(id) + '/signatures', {
      ...body,
      signatures: [{ ...body.signatures[0], fieldId: '99999999' }],
    }).expect(400);
    await post(path(id) + '/signatures', {
      ...body,
      signatures: [
        { ...body.signatures[0], pngDataUrl: 'data:image/png;base64,YQ==' },
      ],
    }).expect(400);
    const document = await manager().findOneByOrFail(EsignDocument, {
      id: Number(f.document.id),
    });
    await manager().update(EsignDocument, document.id, {
      signingPayloadSha256: '0'.repeat(64),
    });
    await post(path(id) + '/signatures', body).expect(409);
    await manager().update(EsignDocument, document.id, {
      signingPayloadSha256: document.signingPayloadSha256,
    });
    const source = await manager().findOneByOrFail(EsignFileObject, {
      documentId: document.id,
      filePurpose: 'source_pdf',
    });
    await manager().update(EsignFileObject, source.id, {
      sha256: '0'.repeat(64),
    });
    await request(ctx.server)
      .get(path(id) + '/source-file')
      .set('Cookie', cookies[0])
      .expect(409);
    await post(path(id) + '/signatures', body).expect(409);
    expect(
      await manager().count(EsignSignatureRecord, {
        where: { signerId: f.signers[0]!.id },
      }),
    ).toBe(0);
  });
  it.each(['future', 'expired', 'stopped', 'draft', 'deleted'] as const)(
    '%s 文件無法以本人 session 閱讀或新簽署',
    async (state) => {
      const f = await fixture();
      const id = f.signers[0]!.publicId;
      const body = await bodyFor(id);
      const changes =
        state === 'future'
          ? {
              signStartAt: new Date(Date.now() + 3600000),
              signEndAt: new Date(Date.now() + 86400000),
            }
          : state === 'expired'
            ? {
                signStartAt: new Date(Date.now() - 86400000),
                signEndAt: new Date(Date.now() - 3600000),
              }
            : state === 'deleted'
              ? { deletedAt: new Date() }
              : { status: state };
      await manager().update(EsignDocument, Number(f.document.id), changes);
      const status = state === 'draft' || state === 'deleted' ? 404 : 409;
      await post(path(id)).expect(status);
      await request(ctx.server)
        .get(path(id) + '/source-file')
        .set('Cookie', cookies[0])
        .expect(status);
      await post(path(id) + '/signatures', body).expect(status);
      await post(path(id) + '/signatures', body, cookies[2]).expect(404);
    },
  );
});
