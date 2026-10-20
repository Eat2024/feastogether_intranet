import { FakeInvitationMailSender } from '#app/infrastructure/mail/fake-invitation-mail-sender.service';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { ExternalAccessCredentialService } from './external-access-credential.service';
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
    // Redis 以 Map 模擬，TTL 只記錄設定值、不會到期（到期由真 Redis 負責，e2e 另驗）
    const store = new Map<string, string>();
    const ttls = new Map<string, number>();
    const redis = {
      get: (key: string) => Promise.resolve(store.get(key) ?? null),
      set: (key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve();
      },
      setIfAbsent: (key: string, value: string, ttl: number) => {
        if (store.has(key)) return Promise.resolve(false);
        store.set(key, value);
        ttls.set(key, ttl);
        return Promise.resolve(true);
      },
      ttl: (key: string) => Promise.resolve(ttls.get(key) ?? -2),
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
        findById: jest.fn(async (id: number) =>
          id === signer.id ? signer : null,
        ),
        findByIdForUpdate: jest.fn(async (id: number) =>
          id === signer.id ? signer : null,
        ),
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
      new ExternalAccessCredentialService(redis as never),
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

  /** 經驗證碼建立存取，回傳 cookie 中的存取憑證 */
  async function accessCredential(context: Setup): Promise<string> {
    const session = await context.service.createSession(
      token,
      await sentCode(context),
    );
    if (!session.verified) throw new Error('驗證碼應通過');
    return session.credential;
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
        issue: { status: 'sent', retryAfterSeconds: 60 },
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

  it('冷卻中再要求寄送：不寄信、不記錄寄出，回報可再寄送的秒數', async () => {
    const context = setup();
    await context.service.sendOtp(token);

    await expect(context.service.sendOtp(token)).resolves.toEqual({
      email: 'daming.wang@example.com',
      issue: { status: 'cooldown', retryAfterSeconds: 60 },
    });
    expect(context.mailer.otpDeliveries).toHaveLength(1);
    expect(auditedEvents(context.audit)).toEqual(['external_otp.sent']);
  });

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

  it('正確驗證碼建立存取：產生不同於邀請 token 的存取憑證，記錄驗證成功與開啟邀請，驗證碼不進稽核', async () => {
    const context = setup();
    pendingInvitation(context);
    const code = await sentCode(context);

    const session = await context.service.createSession(token, code);
    expect(session).toEqual({
      verified: true,
      signerPublicId: context.signer.publicId,
      credential: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expect(session.verified && session.credential).not.toBe(token);
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

  it('存取憑證對應送出簽名的簽署人；已簽者在文件完成後仍可取得，供重送同一次簽名取回既有結果', async () => {
    const context = setup();
    await expect(
      context.service.signingPrincipal(await accessCredential(context)),
    ).resolves.toEqual({ kind: 'external', signerId: context.signer.id });
  });

  it('只持有邀請 token（未通過驗證碼）時，任務、原始檔、本人副本與送出簽名一律 401', async () => {
    const { service, files, completions } = setup();
    for (const read of [
      () => service.task(token, false),
      () => service.source(token),
      () => service.completedFile(token),
      () => service.signingPrincipal(token),
    ]) {
      await expect(read()).rejects.toMatchObject({ status: 401 });
    }
    expect(files.findDocumentFile).not.toHaveBeenCalled();
    expect(completions.personalCopy).not.toHaveBeenCalled();
  });

  it('結束存取後同一憑證一律 401', async () => {
    const context = setup();
    const credential = await accessCredential(context);
    await context.service.endSession(credential);

    await expect(context.service.task(credential, false)).rejects.toMatchObject(
      { status: 401 },
    );
    await expect(
      context.service.signingPrincipal(credential),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('存取憑證有效但簽署人已刪除時 401', async () => {
    const context = setup();
    const credential = await accessCredential(context);
    Object.assign(context.signer, { deletedAt: new Date() });

    await expect(context.service.source(credential)).rejects.toMatchObject({
      status: 401,
    });
    expect(context.files.findDocumentFile).not.toHaveBeenCalled();
  });

  it('唯讀查詢已簽者的任務，不記錄開啟稽核', async () => {
    const context = setup();
    const credential = await accessCredential(context);
    context.audit.append.mockClear();
    await expect(
      context.service.task(credential, false),
    ).resolves.toMatchObject({ signerPublicId: context.signer.publicId });
    expect(context.audit.append).not.toHaveBeenCalled();
  });

  it('已簽者可下載本人副本', async () => {
    const context = setup();
    const credential = await accessCredential(context);
    await expect(context.service.completedFile(credential)).resolves.toEqual({
      bytes: Buffer.from('%PDF-'),
      fileName: 'completed.pdf',
    });
    expect(context.completions.personalCopy).toHaveBeenCalledWith(
      context.document,
      context.signer,
    );
  });

  it('尚未簽署時下載本人副本回 401', async () => {
    const context = setup();
    pendingInvitation(context);
    const credential = await accessCredential(context);
    await expect(
      context.service.completedFile(credential),
    ).rejects.toMatchObject({ status: 401 });
    expect(context.completions.personalCopy).not.toHaveBeenCalled();
  });
});
