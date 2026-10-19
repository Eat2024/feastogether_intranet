import type { Job } from 'bullmq';
import { ExternalInvitationProcessor } from './external-invitation.processor';

describe('ExternalInvitationProcessor', () => {
  const manager = {} as never;

  function setup(options?: { mailFailure?: boolean; result?: string }) {
    const document = {
      id: 7,
      status: 'active',
      title: '聘僱文件',
      signEndAt: new Date(Date.now() + 86_400_000),
      createdByUser: { name: '建立人' },
    };
    const signer = {
      id: 11,
      publicId: '550e8400-e29b-41d4-a716-446655440000',
      signerType: 'email',
      email: 'candidate@example.test',
      status: 'pending',
      invitationTokenSha256: 'old-digest',
      invitationTokenCiphertext: 'encrypted-token' as string | null,
      invitationExpiresAt: document.signEndAt,
      document,
    };
    const log = {
      id: 19,
      result: options?.result ?? 'pending',
      attemptCount: 0,
      processingStartedAt: undefined as Date | null | undefined,
      nextAttemptAt: undefined as Date | null | undefined,
      completedAt: undefined as Date | null | undefined,
      errorCode: undefined as string | null | undefined,
      signer,
    };
    const notifications = {
      lockDocument: jest.fn(() => Promise.resolve(document)),
      findInvitationContextForUpdate: jest.fn(() => Promise.resolve(log)),
      findLogByIdForUpdate: jest.fn(() => Promise.resolve(log)),
      saveLog: jest.fn(() => Promise.resolve()),
    };
    const signers = {
      findByPublicIdForUpdate: jest.fn(() => Promise.resolve(signer)),
      save: jest.fn(() => Promise.resolve()),
    };
    const mailer = {
      send: options?.mailFailure
        ? jest.fn(() => Promise.reject(new Error('provider unavailable')))
        : jest.fn(() => Promise.resolve()),
    };
    const audit = { append: jest.fn(() => Promise.resolve()) };
    const mysql = {
      transaction: jest.fn(
        <T>(callback: (transactionManager: never) => Promise<T>) =>
          callback(manager),
      ),
    };
    const processor = new ExternalInvitationProcessor(
      mysql as never,
      notifications as never,
      signers as never,
      { decrypt: jest.fn(() => 'opaque-invitation-token') } as never,
      audit as never,
      mailer as never,
    );
    return { processor, document, log, signer, notifications, mailer, audit };
  }

  const job = { data: { notificationLogId: 19 } } as Job<{
    notificationLogId: number;
  }>;

  it.each(['pending', 'failed', 'processing'])(
    '已退休的 %s 工作不能寄出新輪邀請',
    async (result) => {
      const { processor, log, mailer } = setup({ result });
      log.errorCode = 'INVITATION_SUPERSEDED';
      log.processingStartedAt = new Date(Date.now() - 600_000);
      await processor.process(job);
      expect(mailer.send).not.toHaveBeenCalled();
      expect(log.errorCode).toBe('INVITATION_SUPERSEDED');
    },
  );

  it.each([false, true])(
    '舊寄信完成（失敗=%s）不可覆寫新輪資格',
    async (failure) => {
      const { processor, signer, log, mailer } = setup();
      mailer.send.mockImplementation(async () => {
        signer.invitationTokenSha256 = 'new-digest';
        signer.invitationTokenCiphertext = 'new-ciphertext';
        log.result = 'failed';
        log.errorCode = 'INVITATION_SUPERSEDED';
        log.processingStartedAt = null;
        log.nextAttemptAt = null;
        if (failure) throw new Error('傳送失敗');
      });
      await processor.process(job);
      expect(signer.invitationTokenCiphertext).toBe('new-ciphertext');
      expect(log.result).toBe('failed');
      expect(log.errorCode).toBe('INVITATION_SUPERSEDED');
      expect(log.processingStartedAt).toBeNull();
      expect(log.nextAttemptAt).toBeNull();
    },
  );

  it('以 CAS claim 寄送，成功後 delivered、清密文並只追加去敏感 audit', async () => {
    const { processor, document, log, signer, mailer, audit } = setup();
    await processor.process(job);
    expect(mailer.send).toHaveBeenCalledWith({
      recipientEmail: 'candidate@example.test',
      documentTitle: '聘僱文件',
      creatorName: '建立人',
      signEndAt: document.signEndAt,
      invitationToken: 'opaque-invitation-token',
    });
    expect(log.result).toBe('delivered');
    expect(log.attemptCount).toBe(1);
    expect(log.completedAt).toEqual(expect.any(Date));
    expect(signer.invitationTokenCiphertext).toBeNull();
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 7,
        signerId: 11,
        eventType: 'external_invitation.delivered',
      }),
      manager,
    );
    expect(JSON.stringify(audit.append.mock.calls)).not.toMatch(
      /candidate@example|opaque-invitation-token|encrypted-token/,
    );
  });

  it('provider 失敗只保存穩定 error code 與 DB retry time，不向 BullMQ 偽裝成功投遞', async () => {
    const { processor, log, signer } = setup({ mailFailure: true });
    await processor.process(job);
    expect(log.result).toBe('failed');
    expect(log.errorCode).toBe('MAIL_DELIVERY_FAILED');
    expect(log.nextAttemptAt).toEqual(expect.any(Date));
    expect(log.completedAt).toBeUndefined();
    expect(signer.invitationTokenCiphertext).toBe('encrypted-token');
  });

  it('delivered 或其他不可 claim 狀態的重複 job 為 no-op', async () => {
    const { processor, mailer, notifications } = setup({
      result: 'delivered',
    });
    await processor.process(job);
    expect(mailer.send).not.toHaveBeenCalled();
    expect(notifications.saveLog).not.toHaveBeenCalled();
  });

  it('provider accept 後若 processing fence 已改變，舊 worker 不得提交 delivered', async () => {
    const { processor, log, signer, notifications, audit } = setup();
    notifications.findLogByIdForUpdate.mockImplementation(() => {
      log.processingStartedAt = new Date(
        (log.processingStartedAt?.getTime() ?? Date.now()) + 1,
      );
      return Promise.resolve(log);
    });
    await processor.process(job);
    expect(log.result).toBe('processing');
    expect(signer.invitationTokenCiphertext).toBe('encrypted-token');
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('provider accept 後若簽署或停止使 credential 失效，不得提交 delivered audit', async () => {
    const { processor, log, signer, mailer, audit } = setup();
    mailer.send.mockImplementation(() => {
      signer.status = 'signed';
      signer.invitationTokenCiphertext = null;
      return Promise.resolve();
    });

    await processor.process(job);

    expect(log.result).toBe('failed');
    expect(log.errorCode).toBe('INVITATION_NO_LONGER_ACTIVE');
    expect(log.nextAttemptAt).toBeNull();
    expect(audit.append).not.toHaveBeenCalled();
  });
  it('寄送期間文件停止時不提交 delivered，且清除排程欄位為 SQL NULL', async () => {
    const { processor, document, log, mailer, audit } = setup();
    mailer.send.mockImplementation(() => {
      document.status = 'stopped';
      return Promise.resolve();
    });
    await processor.process(job);
    expect(log.result).toBe('failed');
    expect(log.processingStartedAt).toBeNull();
    expect(log.nextAttemptAt).toBeNull();
    expect(audit.append).not.toHaveBeenCalled();
  });
});
