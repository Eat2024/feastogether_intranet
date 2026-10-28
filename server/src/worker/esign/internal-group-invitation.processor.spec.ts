import type { Job } from 'bullmq';
import { EsignNotificationLog } from '#app/features/esign/entities/esign-notification-log.entity';
import { ExternalInvitationProcessor } from './external-invitation.processor';
import type {
  SendInternalGroupMailInput,
  InternalMailRecipientResult,
} from '#app/infrastructure/mail/invitation-mail-sender.port';

function setup(emails: string[]) {
  const document = {
    id: 7,
    status: 'active',
    title: '文件',
    signStartAt: new Date(Date.now() - 60_000),
    signEndAt: new Date(Date.now() + 86_400_000),
    createdByUser: { name: '人資' },
  };
  const logs = emails.map((email, i) =>
    Object.assign(new EsignNotificationLog(), {
      id: i + 1,
      batchId: 9,
      signerId: i + 1,
      result: 'pending',
      attemptCount: 0,
      signer: {
        id: i + 1,
        publicId: `signer-${i}`,
        signerType: 'user',
        email,
        status: 'pending',
        documentId: 7,
        document,
      },
    }),
  );
  const batch = { id: 9, documentId: 7, kind: 'invitation' };
  const notifications = {
    findBySignerIds: jest
      .fn<Promise<EsignNotificationLog[]>, unknown[]>()
      .mockResolvedValue([]),
    findInternalBatchContextForUpdate: jest.fn(async () => ({
      document,
      batch,
      logs,
    })),
    findInvitationContextForUpdate: jest.fn(async () => ({
      ...logs[0],
      batch,
    })),
    saveLog: jest.fn(async () => undefined),
    saveLogs: jest.fn(async () => undefined),
  };
  const mailer = {
    send: jest.fn(),
    sendOtp: jest.fn(),
    sendInternalGroup: jest.fn(
      async (
        input: SendInternalGroupMailInput,
      ): Promise<InternalMailRecipientResult[]> =>
        input.recipientEmails.map((recipientEmail) => ({
          recipientEmail,
          status: 'accepted',
          retryable: false,
        })),
    ),
  };
  const audit = { append: jest.fn() };
  // 序列交易模擬 DB 鎖；SMTP 仍在交易外，可讓下一 worker 同時進入。
  let queue = Promise.resolve();
  const mysql = {
    transaction: <T>(fn: (manager: never) => Promise<T>) => {
      const result = queue.then(() => fn({} as never));
      queue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
  const signers = { save: jest.fn() };
  const processor = new ExternalInvitationProcessor(
    mysql as never,
    notifications as never,
    signers as never,
    {} as never,
    audit as never,
    mailer,
  );
  const job = { data: { notificationBatchId: 9 } } as Job;
  return {
    processor,
    logs,
    mailer,
    job,
    notifications,
    audit,
    document,
    batch,
  };
}

describe('內部通知群寄', () => {
  it('同批兩位員工以一封 BCC 寄出，共用信箱只投遞一次但保留各自結果', async () => {
    const { processor, logs, mailer, job } = setup([
      'A@example.test',
      'a@example.test',
      'b@example.test',
    ]);
    await processor.process(job);
    expect(mailer.sendInternalGroup).toHaveBeenCalledTimes(1);
    expect(mailer.sendInternalGroup.mock.calls[0][0]).toMatchObject({
      recipientEmails: ['a@example.test', 'b@example.test'],
      portalLoginUrl:
        'http://portal.feastogether.com.tw/portal/login?redirect_to=hr/esign/mine',
    });
    expect(logs.map((log) => log.result)).toEqual([
      'delivered',
      'delivered',
      'delivered',
    ]);
    expect(mailer.send).not.toHaveBeenCalled();
  });
  it.each([
    [1, [1]],
    [2, [2]],
    [50, [50]],
    [51, [50, 1]],
  ])('不同收件地址 %s 人按50上限拆批', async (count, sizes) => {
    const { processor, mailer, job } = setup(
      Array.from({ length: count as number }, (_, i) => `u${i}@example.test`),
    );
    await processor.process(job);
    expect(
      mailer.sendInternalGroup.mock.calls.map(
        ([input]) => input.recipientEmails.length,
      ),
    ).toEqual(sizes);
  });

  it('兩個 worker 同時處理同批不重複寄送', async () => {
    const { processor, logs, mailer, job } = setup([
      'a@example.test',
      'b@example.test',
    ]);
    await Promise.all([processor.process(job), processor.process(job)]);
    expect(mailer.sendInternalGroup).toHaveBeenCalledTimes(1);
    expect(logs.every((log) => log.result === 'delivered')).toBe(true);
  });

  it('歷史內部單 log 工作改為整批通知', async () => {
    const { processor, mailer } = setup(['a@example.test', 'b@example.test']);
    await processor.process({ data: { notificationLogId: 1 } } as Job);
    expect(mailer.sendInternalGroup).toHaveBeenCalledTimes(1);
    expect(
      mailer.sendInternalGroup.mock.calls[0][0].recipientEmails,
    ).toHaveLength(2);
  });

  it('暫時拒收只重試失敗地址，30/60秒退避且最多3次，已接受不再寄', async () => {
    jest.useFakeTimers();
    try {
      const { processor, logs, mailer, job } = setup([
        'a@example.test',
        'b@example.test',
        'c@example.test',
      ]);
      mailer.sendInternalGroup.mockImplementation(async (input) =>
        input.recipientEmails.map((recipientEmail) => ({
          recipientEmail,
          status: recipientEmail.startsWith('a') ? 'accepted' : 'rejected',
          retryable: recipientEmail.startsWith('b'),
        })),
      );
      await processor.process(job);
      expect(logs.map((log) => log.result)).toEqual([
        'delivered',
        'failed',
        'failed',
      ]);
      expect(logs[1].nextAttemptAt?.getTime()).toBe(Date.now() + 30_000);
      expect(logs[2].nextAttemptAt).toBeNull();
      await processor.process(job);
      expect(mailer.sendInternalGroup).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(30_000);
      await processor.process(job);
      expect(mailer.sendInternalGroup.mock.calls[1][0].recipientEmails).toEqual(
        ['b@example.test'],
      );
      expect(logs[1].nextAttemptAt?.getTime()).toBe(Date.now() + 60_000);
      jest.advanceTimersByTime(60_000);
      await processor.process(job);
      expect(logs[1].attemptCount).toBe(3);
      expect(logs[1].nextAttemptAt).toBeNull();
      jest.advanceTimersByTime(600_000);
      await processor.process(job);
      expect(mailer.sendInternalGroup).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('缺結果與 adapter 拋錯均記 unknown，stale processing 不重寄', async () => {
    const { processor, logs, mailer, job } = setup([
      'a@example.test',
      'b@example.test',
    ]);
    logs[0].result = 'processing';
    logs[0].processingStartedAt = new Date(Date.now() - 600_000);
    mailer.sendInternalGroup.mockRejectedValue(
      new Error('DATA connection lost'),
    );
    await processor.process(job);
    expect(logs.map((log) => log.result)).toEqual(['unknown', 'unknown']);
    expect(mailer.sendInternalGroup.mock.calls[0][0].recipientEmails).toEqual([
      'b@example.test',
    ]);
    await processor.process(job);
    expect(mailer.sendInternalGroup).toHaveBeenCalledTimes(1);
  });

  it('寄送期間通知退休時，完成結果不覆寫舊租約', async () => {
    const { processor, logs, mailer, job } = setup(['a@example.test']);
    mailer.sendInternalGroup.mockImplementation(async (input) => {
      logs[0].errorCode = 'INVITATION_SUPERSEDED';
      logs[0].result = 'failed';
      logs[0].leaseToken = null;
      return input.recipientEmails.map((recipientEmail) => ({
        recipientEmail,
        status: 'accepted',
        retryable: false,
      }));
    });
    await processor.process(job);
    expect(logs[0].result).toBe('failed');
    expect(logs[0].errorCode).toBe('INVITATION_SUPERSEDED');
  });

  it('SMTP成功後落庫失敗，重啟後只復原 unknown', async () => {
    const { processor, logs, mailer, job, notifications } = setup([
      'a@example.test',
    ]);
    notifications.findInternalBatchContextForUpdate.mockRejectedValueOnce(
      new Error('DB unavailable'),
    );
    await expect(processor.process(job)).rejects.toThrow();
    expect(mailer.sendInternalGroup).not.toHaveBeenCalled();
    const original =
      notifications.findInternalBatchContextForUpdate.getMockImplementation()!;
    notifications.findInternalBatchContextForUpdate
      .mockImplementationOnce(original)
      .mockRejectedValueOnce(new Error('finish unavailable'));
    await expect(processor.process(job)).rejects.toThrow('finish unavailable');
    expect(logs[0].result).toBe('processing');
    logs[0].processingStartedAt = new Date(Date.now() - 600_000);
    await processor.process(job);
    expect(logs[0].result).toBe('unknown');
    expect(mailer.sendInternalGroup).toHaveBeenCalledTimes(1);
  });
  it.each(['delivered', 'unknown'])(
    '歷史同地址已有 %s，剩餘 pending 明確略過而非無限補列',
    async (result) => {
      const { processor, logs, mailer, job } = setup([
        'a@example.test',
        'a@example.test',
      ]);
      logs[0].result = result;
      await processor.process(job);
      expect(logs[0].result).toBe(result);
      expect(logs[1].result).toBe('skipped');
      expect(logs[1].nextAttemptAt).toBeNull();
      expect(mailer.sendInternalGroup).not.toHaveBeenCalled();
    },
  );

  it('同地址某明細尚在退避時整組等待，重試到期後只寄一封', async () => {
    jest.useFakeTimers();
    try {
      const { processor, logs, mailer, job } = setup([
        'a@example.test',
        'a@example.test',
      ]);
      logs[0].result = 'failed';
      logs[0].attemptCount = 1;
      logs[0].nextAttemptAt = new Date(Date.now() + 30_000);
      await processor.process(job);
      expect(mailer.sendInternalGroup).not.toHaveBeenCalled();
      jest.advanceTimersByTime(30_000);
      await processor.process(job);
      expect(mailer.sendInternalGroup).toHaveBeenCalledTimes(1);
      expect(logs.map((log) => log.result)).toEqual(['delivered', 'delivered']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('忽略不屬本批地址並記去敏感協定異常，缺少結果者 unknown', async () => {
    const { processor, logs, mailer, job, audit } = setup([
      'a@example.test',
      'b@example.test',
    ]);
    mailer.sendInternalGroup.mockResolvedValue([
      {
        recipientEmail: 'a@example.test',
        status: 'accepted',
        retryable: false,
      },
      {
        recipientEmail: 'unexpected@example.test',
        status: 'accepted',
        retryable: false,
      },
    ]);
    await processor.process(job);
    expect(logs.map((log) => log.result)).toEqual(['delivered', 'unknown']);
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'internal_notification.protocol_error',
        metadata: { errorCode: 'MAIL_RESULT_MISMATCH' },
      }),
      expect.anything(),
    );
    expect(JSON.stringify(audit.append.mock.calls)).not.toContain(
      '@example.test',
    );
  });
  it('adapter 回 DATA 斷線 unknown 後沒有 retry time，重複工作不會再發信', async () => {
    const { processor, logs, mailer, job } = setup(['a@example.test']);
    mailer.sendInternalGroup.mockResolvedValue([
      { recipientEmail: 'a@example.test', status: 'unknown', retryable: false },
    ]);
    await processor.process(job);
    expect(logs[0].result).toBe('unknown');
    expect(logs[0].nextAttemptAt).toBeNull();
    await processor.process(job);
    expect(mailer.sendInternalGroup).toHaveBeenCalledTimes(1);
  });
  it('內部催簽 worker 重新檢查開始時間，未開始則 skipped 不寄送', async () => {
    const { processor, logs, mailer, job, document, batch } = setup([
      'a@example.test',
    ]);
    batch.kind = 'reminder';
    document.signStartAt = new Date(Date.now() + 60_000);
    await processor.process(job);
    expect(logs[0].result).toBe('skipped');
    expect(logs[0].errorCode).toBe('SIGNING_WINDOW_CLOSED');
    expect(mailer.sendInternalGroup).not.toHaveBeenCalled();
  });

  it('內部催簽 worker 重新檢查同日已受理歷史，過期排隊工作不得再寄', async () => {
    const { processor, logs, mailer, job, batch, notifications } = setup([
      'a@example.test',
    ]);
    batch.kind = 'reminder';
    notifications.findBySignerIds.mockResolvedValue([
      Object.assign(new EsignNotificationLog(), {
        id: 99,
        signerId: 1,
        result: 'delivered',
        dispatchDate: new Date(Date.now() + 8 * 3600000)
          .toISOString()
          .slice(0, 10),
        batch: { kind: 'reminder' },
      }),
    ]);
    await processor.process(job);
    expect(logs[0].result).toBe('skipped');
    expect(logs[0].errorCode).toBe('REMINDER_DAILY_LIMIT');
    expect(mailer.sendInternalGroup).not.toHaveBeenCalled();
  });
});
