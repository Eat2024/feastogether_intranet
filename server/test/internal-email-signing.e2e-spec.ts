import { HttpService } from '@nestjs/axios';
import { randomBytes, randomUUID } from 'node:crypto';
import { of } from 'rxjs';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { AuthService } from '#app/features/auth/services/auth.service';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import { User } from '#app/features/users/entities/user.entity';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { SignerRepository } from '#app/features/esign/repositories/signer.repository';
import { EsignSigner } from '#app/features/esign/entities/esign-signer.entity';
import { EsignAuditEvent } from '#app/features/esign/entities/esign-audit-event.entity';
import { ExternalAccessCredentialService } from '#app/features/esign/services/external-access-credential.service';
import { INTERNAL_PORTAL_LOGIN_URL } from '#app/features/esign/esign.constants';
import { EsignTokenService } from '#app/features/esign/services/esign-token.service';
import { EsignSigningService } from '#app/features/esign/services/esign-signing.service';
import { apiData } from './api-response.helper';
import { esignTestPng } from './esign-test-png';
import { otpMails, requestOtp, submitOtp } from './external-session.helper';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

describe('Spec016 舊內部邀請切換與外部 OTP 授權', () => {
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
  async function fixture(external = false) {
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
            .map((user, index) =>
              external
                ? {
                    type: 'email',
                    name: user.name,
                    email: `shared${index}@example.test`,
                  }
                : { type: 'user', userId: String(user.id) },
            ),
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
    const tokens: string[] = [];
    const legacyCookies: string[] = [];
    for (const signer of signers) {
      if (!signer) throw new Error('合成簽署人不存在');
      if (!external) {
        // 明確建立切換前既存 token 與 Redis cookie；新發起流程不再建立這些憑證。
        const legacy = ctx.app.get(EsignTokenService).createInvitationToken();
        Object.assign(signer, {
          invitationTokenSha256: legacy.digest,
          invitationTokenCiphertext: legacy.ciphertext,
          invitationExpiresAt: new Date(Date.now() + 86400000),
        });
        await ctx.app.get(MysqlService).getManager().save(EsignSigner, signer);
        legacyCookies.push(
          `FT_ESIGN_EXTERNAL_ACCESS=${await ctx.app.get(ExternalAccessCredentialService).issue(signer.id, legacy.digest)}`,
        );
      }
      tokens.push(
        ctx.app
          .get(EsignTokenService)
          .decrypt(signer.invitationTokenCiphertext!),
      );
    }
    return { document, signers, tokens, legacyCookies };
  }
  async function verify(token: string) {
    await requestOtp(ctx, token).expect(200);
    const code = otpMails(ctx).at(-1)!.code;
    const result = await submitOtp(ctx, token, code).expect(303);
    expect(result.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(result.headers['set-cookie'][0]).not.toMatch(/Expires=|Max-Age=/i);
    await submitOtp(ctx, token, code).expect(401);
    return String(result.headers['set-cookie'][0]);
  }
  it('外部逐人 OTP 隔離；只持邀請不能看檔，驗證後可簽署及寬等重送', async () => {
    const f = await fixture(true);
    const before = otpMails(ctx).length;
    await request(ctx.server)
      .get(`/api/external-signature-invitations/${f.tokens[0]}`)
      .expect(200);
    expect(otpMails(ctx)).toHaveLength(before);
    await request(ctx.server).get('/api/external-signing-task').expect(401);
    await request(ctx.server)
      .get('/api/external-signing-task')
      .set('Cookie', `FT_ESIGN_EXTERNAL_ACCESS=${f.tokens[0]}`)
      .expect(401);
    const cookie = await verify(f.tokens[0]);
    await requestOtp(ctx, f.tokens[0]).expect(429);
    const task = apiData<{
      signer: Record<string, unknown>;
      consent: { version: string };
      fields: Array<{ id: string }>;
    }>(
      await request(ctx.server)
        .get('/api/external-signing-task')
        .set('Cookie', cookie)
        .expect(200),
    );
    expect(task.signer).toMatchObject({
      type: 'email',
      employeeNo: null,
      department: null,
      title: null,
    });
    expect(task.signer).not.toHaveProperty('userId');
    expect(task.signer).not.toHaveProperty('note');
    await request(ctx.server)
      .get('/api/esign/documents')
      .set('Cookie', cookie)
      .expect(401);
    await request(ctx.server)
      .get('/api/external-signing-task/source-file')
      .set('Cookie', cookie)
      .expect(200);
    const body = {
      signerPublicId: f.signers[0]!.publicId,
      requestId: randomUUID(),
      consentVersion: task.consent.version,
      accepted: true,
      signatures: task.fields.map((field) => ({
        fieldId: field.id,
        pngDataUrl: `data:image/png;base64,${esignTestPng(10).toString('base64')}`,
      })),
    };
    await request(ctx.server)
      .post('/api/external-signing-task/signatures')
      .set('Cookie', cookie)
      .set('Origin', 'https://evil.example.test')
      .send(body)
      .expect(403);
    await request(ctx.server)
      .post('/api/external-signing-task/signatures')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({ ...body, signerPublicId: f.signers[1]!.publicId })
      .expect(409);
    await request(ctx.server)
      .post('/api/external-signing-task/signatures')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send(body)
      .expect(201);
    await request(ctx.server)
      .post('/api/external-signing-task/signatures')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send(body)
      .expect(200);
    await expect(
      ctx.app
        .get(EsignSigningService)
        .sign(
          body.signerPublicId,
          { kind: 'internal', userId: users[0].id },
          body,
          {},
        ),
    ).rejects.toMatchObject({ code: 'ESIGN_RESOURCE_NOT_FOUND' });
    const otherCookie = await verify(f.tokens[1]);
    await request(ctx.server)
      .post('/api/external-signing-task/rejection')
      .set('Cookie', otherCookie)
      .set('Origin', origin)
      .send({
        signerPublicId: f.signers[1]!.publicId,
        requestId: randomUUID(),
        reason: '合成拒簽',
      })
      .expect(201);
    await request(ctx.server)
      .get('/api/external-signing-task/source-file')
      .set('Cookie', otherCookie)
      .expect(401);
  });
  it('舊內部 GET 無副作用，POST 固定 Portal；有效舊 cookie 所有入口403而本人 session 可簽', async () => {
    const f = await fixture();
    const publicId = f.signers[0]!.publicId;
    const manager = ctx.app.get(MysqlService).getManager();
    const before = await manager.count(EsignAuditEvent, {
      where: { documentId: Number(f.document.id) },
    });
    const mails = otpMails(ctx).length;
    await request(ctx.server)
      .get(`/api/external-signature-invitations/${f.tokens[0]}`)
      .expect(200);
    for (const response of [
      await requestOtp(ctx, f.tokens[0]).expect(303),
      await submitOtp(ctx, f.tokens[0], '123456').expect(303),
    ]) {
      expect(response.headers.location).toBe(INTERNAL_PORTAL_LOGIN_URL);
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(response.text).not.toContain('合成內部驗證文件');
    }
    expect(otpMails(ctx)).toHaveLength(mails);
    expect(
      await manager.count(EsignAuditEvent, {
        where: { documentId: Number(f.document.id) },
      }),
    ).toBe(before);
    await requestOtp(ctx, 'Z'.repeat(43)).expect(401);
    const body = {
      signerPublicId: publicId,
      requestId: randomUUID(),
      consentVersion: 'esign-consent-v1',
      accepted: true,
      signatures: [
        {
          fieldId: f.document.fields[0].id,
          pngDataUrl: `data:image/png;base64,${esignTestPng(10).toString('base64')}`,
        },
      ],
    };
    for (const [method, suffix, payload] of [
      ['get', '', {}],
      ['post', '', {}],
      ['get', '/source-file', {}],
      ['post', '/signatures', body],
      [
        'post',
        '/rejection',
        { signerPublicId: publicId, requestId: randomUUID() },
      ],
      ['post', '/completed-file/downloads', {}],
    ] as const) {
      const response = await request(ctx.server)
        [method]('/api/external-signing-task' + suffix)
        .set('Cookie', f.legacyCookies[0])
        .set('Origin', origin)
        .send(payload)
        .expect(403);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.text).not.toContain('<html');
      expect(response.body).toMatchObject({
        error: {
          code: 'ESIGN_INTERNAL_LOGIN_REQUIRED',
          details: { portalLoginUrl: INTERNAL_PORTAL_LOGIN_URL },
        },
      });
    }
    const task = apiData<{ consent: { version: string } }>(
      await request(ctx.server)
        .post('/api/esign/signing-tasks/' + publicId)
        .set('Cookie', cookies[0])
        .set('Origin', origin)
        .expect(201),
    );
    const { signerPublicId: _, ...internalBody } = body;
    internalBody.consentVersion = task.consent.version;
    await request(ctx.server)
      .post(`/api/esign/signing-tasks/${publicId}/signatures`)
      .set('Cookie', cookies[0])
      .set('Origin', origin)
      .send(internalBody)
      .expect(201);
    await request(ctx.server)
      .post('/api/external-signing-task/signatures')
      .set('Cookie', f.legacyCookies[0])
      .set('Origin', origin)
      .send(body)
      .expect(403);
    await request(ctx.server)
      .post(`/api/esign/signing-tasks/${publicId}/signatures`)
      .set('Cookie', cookies[2])
      .set('Origin', origin)
      .send(internalBody)
      .expect(404);
    await request(ctx.server)
      .get(`/api/esign/documents/${f.document.id}/source-file`)
      .set('Cookie', cookies[0])
      .expect(200);
  });

  it('共用信箱不共用 OTP，錯滿五次失效；並發驗證只建立一次存取', async () => {
    const first = await fixture(true);
    const second = await fixture(true);
    const f = { tokens: [first.tokens[0], second.tokens[0]] };
    await requestOtp(ctx, f.tokens[0]).expect(200);
    const firstCode = otpMails(ctx).at(-1)!.code;
    // 另一指派還沒寄碼，不能使用同信箱已收到的碼。
    await submitOtp(ctx, f.tokens[1], firstCode).expect(401);
    const wrong = firstCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++)
      await submitOtp(ctx, f.tokens[0], wrong).expect(401);
    await submitOtp(ctx, f.tokens[0], firstCode).expect(401);
    await requestOtp(ctx, f.tokens[1]).expect(200);
    const secondCode = otpMails(ctx).at(-1)!.code;
    const responses = await Promise.all([
      submitOtp(ctx, f.tokens[1], secondCode),
      submitOtp(ctx, f.tokens[1], secondCode),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      303, 401,
    ]);
    expect(
      responses.filter((response) => response.headers['set-cookie']),
    ).toHaveLength(1);
  });
});
