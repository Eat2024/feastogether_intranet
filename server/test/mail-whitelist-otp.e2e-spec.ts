import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { User } from '#app/features/users/entities/user.entity';
import { EsignDocument } from '#app/features/esign/entities/esign-document.entity';
import { EsignSigner } from '#app/features/esign/entities/esign-signer.entity';
import { EsignAuditEvent } from '#app/features/esign/entities/esign-audit-event.entity';
import { EsignTokenService } from '#app/features/esign/services/esign-token.service';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { RedisService } from '#app/infrastructure/database/redis/redis.service';
import { FeastogetherClient } from '#app/infrastructure/http-client/feastogether/feastogether.client';
import { FakeInvitationMailSender } from '#app/infrastructure/mail/fake-invitation-mail-sender.service';
import { GuardedInvitationMailSender } from '#app/infrastructure/mail/guarded-invitation-mail-sender.service';
import { INVITATION_MAIL_SENDER } from '#app/infrastructure/mail/invitation-mail-sender.port';
import { MailRecipientWhitelist } from '#app/infrastructure/mail/mail-recipient-whitelist.entity';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';
import { randomClientIp } from './signature-verification.helper';

describe('Spec018 OTP 白名單 HTTP 與寄送結果', () => {
  let ctx: SecurityE2eContext;
  let creator: User;
  let sourceFailed = false;
  const empid = `OTP${randomBytes(4).toString('hex')}`;
  const email = `${empid.toLowerCase()}@example.test`;
  const transport = jest.spyOn(FakeInvitationMailSender.prototype, 'sendOtp');
  const hr = {
    get: (path: string) => {
      if (sourceFailed) throw new Error('synthetic-upstream-secret');
      if (path === `/api/v1/hr/staff_lookup?person_empid=${empid}`)
        return Promise.resolve([
          {
            person_empid: empid,
            person_name: '合成白名單員工',
            person_status: 1,
            person_status_name: '正式',
            department_id: null,
          },
        ]);
      throw new Error('未安排的合成上游查詢');
    },
    post: (path: string, body: { person_empids: string[] }) => {
      if (sourceFailed) throw new Error('synthetic-upstream-secret');
      if (path === '/api/v1/hr/staff_emails')
        return Promise.resolve(
          body.person_empids
            .filter((id) => id === empid)
            .map((person_empid) => ({ person_empid, email })),
        );
      throw new Error('未安排的合成上游查詢');
    },
  };
  beforeAll(async () => {
    ctx = await createSecurityE2eApp(
      (builder) => builder.overrideProvider(FeastogetherClient).useValue(hr),
      null,
    );
    const manager = ctx.app.get(MysqlService).getManager();
    creator = await manager.save(
      User,
      manager.create(User, {
        empid: `C${empid}`,
        name: '合成建立人',
        isActive: true,
      }),
    );
    expect(ctx.app.get(INVITATION_MAIL_SENDER)).toBeInstanceOf(
      GuardedInvitationMailSender,
    );
  });
  beforeEach(async () => {
    transport.mockClear();
    sourceFailed = false;
    await ctx.app
      .get(MysqlService)
      .getManager()
      .delete(MailRecipientWhitelist, { type: 'employee', value: empid });
  });
  afterAll(async () => {
    transport.mockRestore();
    if (ctx) await closeSecurityE2eApp(ctx);
  });
  async function fixture() {
    const manager = ctx.app.get(MysqlService).getManager();
    const document = await manager.save(
      EsignDocument,
      manager.create(EsignDocument, {
        docNumber: randomUUID(),
        title: '合成 OTP 文件',
        createdByUserId: creator.id,
        status: 'active',
        signStartAt: new Date(Date.now() - 60_000),
        signEndAt: new Date(Date.now() + 3600_000),
      }),
    );
    const token = ctx.app.get(EsignTokenService).createInvitationToken();
    const signer = await manager.save(
      EsignSigner,
      manager.create(EsignSigner, {
        publicId: randomUUID(),
        documentId: document.id,
        signerType: 'email',
        email,
        nameSnapshot: '合成收件人',
        status: 'pending',
        invitationTokenSha256: token.digest,
        invitationTokenCiphertext: token.ciphertext,
        invitationExpiresAt: document.signEndAt,
      }),
    );
    return { token: token.token, signer };
  }
  async function allow() {
    const manager = ctx.app.get(MysqlService).getManager();
    await manager.save(
      MailRecipientWhitelist,
      manager.create(MailRecipientWhitelist, {
        type: 'employee',
        value: empid,
      }),
    );
  }
  const otp = (token: string, ip = randomClientIp()) =>
    request(ctx.server)
      .post('/api/external-signature-otps')
      .set('Origin', 'http://localhost:3000')
      .set('X-Forwarded-For', ip)
      .type('form')
      .send({ token });
  const verify = (token: string, code: string) =>
    request(ctx.server)
      .post('/api/external-signature-session')
      .set('Origin', 'http://localhost:3000')
      .set('X-Forwarded-For', randomClientIp())
      .type('form')
      .send({ token, code });
  const audits = (signer: EsignSigner) =>
    ctx.app
      .get(MysqlService)
      .getManager()
      .count(EsignAuditEvent, {
        where: { signerId: signer.id, eventType: 'external_otp.sent' },
      });
  it('阻擋回 403 安全頁且無新碼或成功稽核；新增規則後立即可寄出並驗證', async () => {
    const { token, signer } = await fixture();
    const blocked = await otp(token).expect(403);
    expect(blocked.text).toContain(
      '此環境未開放寄送至此收件人，請聯絡系統管理員',
    );
    expect(blocked.text).not.toContain('<form');
    expect(blocked.text).not.toContain(email);
    expect(transport).not.toHaveBeenCalled();
    expect(await audits(signer)).toBe(0);
    const redis = ctx.app.get(RedisService);
    for (const key of ['code', 'cooldown', 'hourly'])
      expect(
        await redis.get(`esign:external-otp:${signer.id}:${key}`),
      ).toBeNull();
    await verify(token, '123456').expect(401);
    await allow();
    expect(
      await ctx.app
        .get(MysqlService)
        .getManager()
        .count(User, { where: { empid } }),
    ).toBe(0);
    await otp(token).expect(200);
    const [mail] = transport.mock.calls[0];
    expect(mail.recipientEmail).toBe(email);
    expect(await audits(signer)).toBe(1);
    await verify(token, mail.code).expect(303);
  });
  it('來源故障回 503、不寄送、不增成功次數，恢復後無冷卻即可寄出', async () => {
    const { token, signer } = await fixture();
    await allow();
    sourceFailed = true;
    const failed = await otp(token).expect(503);
    expect(failed.text).not.toContain('synthetic-upstream-secret');
    expect(transport).not.toHaveBeenCalled();
    expect(await audits(signer)).toBe(0);
    const redis = ctx.app.get(RedisService);
    for (const key of ['code', 'cooldown', 'hourly'])
      expect(
        await redis.get(`esign:external-otp:${signer.id}:${key}`),
      ).toBeNull();
    sourceFailed = false;
    await otp(token).expect(200);
    expect(await audits(signer)).toBe(1);
  });
  it('真正傳輸失敗仍回 503，未儲存新碼，重試成功後保留冷卻限制', async () => {
    const { token, signer } = await fixture();
    await allow();
    transport.mockRejectedValueOnce(new Error('synthetic-smtp-secret'));
    const failed = await otp(token).expect(503);
    expect(failed.text).not.toContain('synthetic-smtp-secret');
    expect(await audits(signer)).toBe(0);
    const [unsent] = transport.mock.calls[0];
    await verify(token, unsent.code).expect(401);
    await otp(token).expect(200);
    await otp(token).expect(429);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(await audits(signer)).toBe(1);
  });
  it('撤銷後重寄被阻擋仍保留原有效碼，且不能新增成功稽核', async () => {
    const { token, signer } = await fixture();
    await allow();
    await otp(token).expect(200);
    const [mail] = transport.mock.calls[0];
    const redis = ctx.app.get(RedisService);
    await redis.del(`esign:external-otp:${signer.id}:cooldown`);
    const manager = ctx.app.get(MysqlService).getManager();
    await manager.softDelete(MailRecipientWhitelist, {
      type: 'employee',
      value: empid,
    });
    await otp(token).expect(403);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await audits(signer)).toBe(1);
    expect(await redis.get(`esign:external-otp:${signer.id}:hourly`)).toBe('1');
    await verify(token, mail.code).expect(303);
  });
  it('白名單阻擋不取消 Origin、邀請驗證與 IP 節流', async () => {
    const { token } = await fixture();
    await request(ctx.server)
      .post('/api/external-signature-otps')
      .set('Origin', 'https://untrusted.example.test')
      .type('form')
      .send({ token })
      .expect(403);
    await otp('invalid').expect(400);
    const ip = randomClientIp();
    const statuses: number[] = [];
    for (let index = 0; index < 12; index++)
      statuses.push((await otp(token, ip)).status);
    expect(statuses).toContain(403);
    expect(statuses).toContain(429);
    expect(transport).not.toHaveBeenCalled();
  });
});
