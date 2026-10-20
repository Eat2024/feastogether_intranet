import { FakeInvitationMailSender } from '#app/infrastructure/mail/fake-invitation-mail-sender.service';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { ExternalAccessService } from './external-access.service';
import { ExternalOtpService } from './external-otp.service';

describe('ExternalAccessService', () => {
  const manager = {} as never;

  function setup() {
    const signer = {
      id: 3,
      publicId: 'c854d925-1d70-49dc-9c81-abf18409ae42',
      documentId: 4,
      signerType: 'email',
      email: 'daming.wang@example.com',
      status: 'signed',
      invitationTokenSha256: 'a'.repeat(64),
      invitationExpiresAt: null as Date | null,
    };
    const document = {
      id: 4,
      title: '供應商保密協議',
      status: 'completed',
      signStartAt: new Date(Date.now() - 60_000),
      signEndAt: new Date(Date.now() + 60_000),
    };
    const files = { findDocumentFile: jest.fn() };
    const audit = { append: jest.fn() };
    const completions = {
      personalCopy: jest.fn(async () => ({
        bytes: Buffer.from('%PDF-'),
        fileName: 'completed.pdf',
      })),
    };
    const access = new EsignAccessPolicyService(
      new EsignDocumentValidationService(),
      {} as never,
    );
    // Redis 以 Map 模擬（TTL 由真 Redis 負責，e2e 另驗）
    const store = new Map<string, string>();
    const redis = {
      get: (key: string) => Promise.resolve(store.get(key) ?? null),
      set: (key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve();
      },
      del: (...keys: string[]) =>
        Promise.resolve(keys.filter((key) => store.delete(key)).length),
      increment: (key: string) => {
        const next = Number(store.get(key) ?? 0) + 1;
        store.set(key, String(next));
        return Promise.resolve(next);
      },
    };
    const mailer = new FakeInvitationMailSender();
    const service = new ExternalAccessService(
      {
        getManager: () => manager,
        transaction: (run: (m: never) => unknown) => run(manager),
      } as never,
      {
        findById: jest.fn(async () => document),
        findByIdForUpdate: jest.fn(async () => document),
      } as never,
      {
        findByInvitationDigest: jest.fn(async () => signer),
        findByInvitationDigestForUpdate: jest.fn(async () => signer),
        completionCounts: jest.fn(async () => ({ pending: 0, signed: 1 })),
      } as never,
      { findByDocument: jest.fn(async () => []) } as never,
      files as never,
      { digest: jest.fn(() => 'a'.repeat(64)) } as never,
      access,
      {} as never,
      { getActive: jest.fn(() => ({ version: 'esign-consent-v1' })) } as never,
      {
        documentSummary: jest.fn(() => ({ id: '4' })),
        signer: jest.fn(() => ({ publicId: signer.publicId })),
        field: jest.fn(),
      } as never,
      {} as never,
      audit as never,
      {} as never,
      completions as never,
      new ExternalOtpService(redis as never),
      mailer,
    );
    return {
      service,
      signer,
      document,
      access,
      files,
      audit,
      completions,
      mailer,
      store,
    };
  }

  const token = 'A'.repeat(43);
  type Setup = ReturnType<typeof setup>;

  function auditedEvents(audit: Setup['audit']) {
    return audit.append.mock.calls.map(
      ([event]: [{ eventType: string }]) => event.eventType,
    );
  }

  /** 寄出驗證碼並回傳信中的驗證碼 */
  async function sentCode({ service, mailer }: Setup): Promise<string> {
    await service.sendOtp(token);
    return mailer.otpDeliveries.at(-1)!.code;
  }

  function pendingInvitation({ signer, document }: Setup) {
    signer.status = 'pending';
    signer.invitationExpiresAt = new Date(Date.now() + 60_000);
    document.status = 'active';
  }

  it('只接受 32-byte base64url、固定 43 字元 invitation token', () => {
    const { service } = setup();
    expect(service.isTokenFormat('A'.repeat(43))).toBe(true);
    expect(service.isTokenFormat('A'.repeat(42))).toBe(false);
    expect(service.isTokenFormat(`${'A'.repeat(42)}=`)).toBe(false);
    expect(service.isTokenFormat(`${'A'.repeat(42)}+`)).toBe(false);
  });

  it.each(['active', 'stopped', 'expired', 'completed'])(
    '已簽者在文件 %s 時可寄出驗證碼：寄到邀請信箱、記錄寄出，不記錄開啟',
    async (status) => {
      const context = setup();
      context.document.status = status;

      await expect(context.service.sendOtp(token)).resolves.toEqual({
        email: 'daming.wang@example.com',
      });

      expect(context.mailer.otpDeliveries).toEqual([
        {
          recipientEmail: 'daming.wang@example.com',
          documentTitle: '供應商保密協議',
          code: expect.stringMatching(/^\d{6}$/),
        },
      ]);
      expect(auditedEvents(context.audit)).toEqual(['external_otp.sent']);
      expect(context.audit.append).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: 4, signerId: 3 }),
        manager,
      );
    },
  );

  it('待簽者在文件停止後不寄驗證碼，回 401', async () => {
    const context = setup();
    pendingInvitation(context);
    context.document.status = 'stopped';

    await expect(context.service.sendOtp(token)).rejects.toMatchObject({
      status: 401,
    });
    expect(context.mailer.otpDeliveries).toEqual([]);
    expect(context.audit.append).not.toHaveBeenCalled();
  });

  it('簽署尚未開始時不寄驗證碼，回 409', async () => {
    const context = setup();
    pendingInvitation(context);
    context.document.signStartAt = new Date(Date.now() + 60_000);

    await expect(context.service.sendOtp(token)).rejects.toMatchObject({
      status: 409,
    });
    expect(context.mailer.otpDeliveries).toEqual([]);
  });

  it('寄信失敗回 503，不保存驗證碼、不記錄寄出', async () => {
    const context = setup();
    jest
      .spyOn(context.mailer, 'sendOtp')
      .mockRejectedValueOnce(new Error('smtp down'));

    await expect(context.service.sendOtp(token)).rejects.toMatchObject({
      status: 503,
      message: '驗證碼寄送失敗，請稍後再試',
    });
    expect(context.store.size).toBe(0);
    expect(context.audit.append).not.toHaveBeenCalled();
  });

  it('正確驗證碼建立存取：記錄驗證成功與開啟邀請，驗證碼不進稽核', async () => {
    const context = setup();
    pendingInvitation(context);
    const code = await sentCode(context);

    await expect(context.service.createSession(token, code)).resolves.toEqual({
      verified: true,
      signerPublicId: context.signer.publicId,
    });
    expect(auditedEvents(context.audit)).toEqual([
      'external_otp.sent',
      'external_otp.verified',
      'external_invitation.opened',
    ]);
    expect(JSON.stringify(context.audit.append.mock.calls)).not.toContain(code);
  });

  it('驗證碼錯誤時記錄失敗與剩餘次數，不建立存取', async () => {
    const context = setup();
    const code = await sentCode(context);
    const wrong = code === '000000' ? '000001' : '000000';

    await expect(context.service.createSession(token, wrong)).resolves.toEqual({
      verified: false,
      email: 'daming.wang@example.com',
      remainingAttempts: 4,
    });
    expect(context.audit.append).toHaveBeenLastCalledWith(
      expect.objectContaining({
        eventType: 'external_otp.failed',
        metadata: { remainingAttempts: 4 },
      }),
      manager,
    );
    expect(auditedEvents(context.audit)).not.toContain(
      'external_invitation.opened',
    );
  });

  it('錯滿 5 次記錄驗證碼失效，之後正確驗證碼也無法建立存取', async () => {
    const context = setup();
    const code = await sentCode(context);
    const wrong = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i += 1)
      await context.service.createSession(token, wrong);

    expect(auditedEvents(context.audit)).toEqual([
      'external_otp.sent',
      ...Array<string>(4).fill('external_otp.failed'),
      'external_otp.locked',
    ]);
    await expect(context.service.createSession(token, code)).resolves.toEqual({
      verified: false,
      email: 'daming.wang@example.com',
      remainingAttempts: 0,
    });
  });

  it('驗證碼已失效（未寄出、過期或已使用）時不記錄稽核', async () => {
    const context = setup();

    await expect(
      context.service.createSession(token, '123456'),
    ).resolves.toMatchObject({ verified: false, remainingAttempts: 0 });
    expect(context.audit.append).not.toHaveBeenCalled();
  });

  it('邀請已失效時不比對驗證碼，回 401 且不消耗驗證碼', async () => {
    const context = setup();
    pendingInvitation(context);
    const code = await sentCode(context);
    context.document.status = 'stopped';

    await expect(
      context.service.createSession(token, code),
    ).rejects.toMatchObject({ status: 401 });
    context.document.status = 'active';
    await expect(
      context.service.createSession(token, code),
    ).resolves.toMatchObject({ verified: true });
  });

  it('已簽者在文件完成後仍可取得簽署人識別碼，供重送同一次簽名取回既有結果', async () => {
    const { service, signer } = setup();
    await expect(service.signingSignerPublicId('A'.repeat(43))).resolves.toBe(
      signer.publicId,
    );
  });

  it('有效的待簽邀請可取得簽署人識別碼', async () => {
    const { service, signer, document } = setup();
    signer.status = 'pending';
    signer.invitationExpiresAt = new Date(Date.now() + 60_000);
    document.status = 'active';
    await expect(service.signingSignerPublicId('A'.repeat(43))).resolves.toBe(
      signer.publicId,
    );
  });

  it('憑證不符時拒絕讀取原始檔', async () => {
    const { service, signer, files } = setup();
    signer.invitationTokenSha256 = 'b'.repeat(64);
    await expect(service.source('A'.repeat(43))).rejects.toMatchObject({
      status: 401,
    });
    expect(files.findDocumentFile).not.toHaveBeenCalled();
  });

  it('唯讀查詢已簽者的任務，不記錄開啟稽核', async () => {
    const { service, signer, audit } = setup();
    await expect(service.task('A'.repeat(43), false)).resolves.toMatchObject({
      signerPublicId: signer.publicId,
    });
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('已簽者可下載本人副本', async () => {
    const { service, signer, document, completions } = setup();
    await expect(service.completedFile('A'.repeat(43))).resolves.toEqual({
      bytes: Buffer.from('%PDF-'),
      fileName: 'completed.pdf',
    });
    expect(completions.personalCopy).toHaveBeenCalledWith(document, signer);
  });

  it('尚未簽署時下載本人副本回 401', async () => {
    const { service, signer, document, completions } = setup();
    signer.status = 'pending';
    signer.invitationExpiresAt = new Date(Date.now() + 60_000);
    document.status = 'active';
    await expect(service.completedFile('A'.repeat(43))).rejects.toMatchObject({
      status: 401,
    });
    expect(completions.personalCopy).not.toHaveBeenCalled();
  });

  it('憑證不符時不讀取本人副本', async () => {
    const { service, signer, completions } = setup();
    signer.invitationTokenSha256 = 'b'.repeat(64);
    await expect(service.completedFile('A'.repeat(43))).rejects.toMatchObject({
      status: 401,
    });
    expect(completions.personalCopy).not.toHaveBeenCalled();
  });
});
