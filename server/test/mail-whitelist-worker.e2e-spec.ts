import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import nodemailer, { type SendMailOptions } from 'nodemailer';
import { SmtpInvitationMailSender } from '#app/infrastructure/mail/smtp-invitation-mail-sender.service';
import { User } from '#app/features/users/entities/user.entity';
import { EsignDocument } from '#app/features/esign/entities/esign-document.entity';
import { EsignSigner } from '#app/features/esign/entities/esign-signer.entity';
import { EsignNotificationBatch } from '#app/features/esign/entities/esign-notification-batch.entity';
import { AuditEventRepository } from '#app/features/esign/repositories/audit-event.repository';
import { NotificationRepository } from '#app/features/esign/repositories/notification.repository';
import { SignerRepository } from '#app/features/esign/repositories/signer.repository';
import { EsignAuditService } from '#app/features/esign/services/esign-audit.service';
import { EsignTokenService } from '#app/features/esign/services/esign-token.service';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';
import { withSchemaTestDatabase } from '#app/infrastructure/database/test/schema-test-database';
import { FeastogetherHrService } from '#app/infrastructure/http-client/feastogether/services/feastogether-hr.service';
import { FeastogetherDepartmentService } from '#app/infrastructure/http-client/feastogether/services/feastogether-department.service';
import { FakeInvitationMailSender } from '#app/infrastructure/mail/fake-invitation-mail-sender.service';
import { GuardedInvitationMailSender } from '#app/infrastructure/mail/guarded-invitation-mail-sender.service';
import { MailRecipientPolicyService } from '#app/infrastructure/mail/mail-recipient-policy.service';
import { MailRecipientWhitelist } from '#app/infrastructure/mail/mail-recipient-whitelist.entity';
import { MailRecipientWhitelistRepository } from '#app/infrastructure/mail/mail-recipient-whitelist.repository';
import { ExternalInvitationProcessor } from '#app/worker/esign/external-invitation.processor';

async function fixture(ds: DataSource) {
  const mysql = new MysqlService(ds);
  const manager = ds.manager;
  const config = new ConfigService({
    NODE_ENV: 'test',
    ESIGN_INVITATION_ENCRYPTION_KEY_B64: Buffer.alloc(32, 'w').toString(
      'base64',
    ),
    EXTERNAL_SIGNING_ORIGIN: 'https://sign.example.test',
  });
  const tokens = new EsignTokenService(config);
  const notifications = new NotificationRepository();
  const auditRepository = new AuditEventRepository();
  // 信箱只來自明確合成人資資料，不從寄送輸入或文件快照自動允許。
  const staff = [
    { person_empid: 'WL0301', email: 'allowed@example.test' },
    { person_empid: 'WL0302', email: 'blocked@example.test' },
  ];
  const upstream = {
    post: jest.fn((_path: string, body: { person_empids: string[] }) =>
      Promise.resolve(
        staff.filter((item) => body.person_empids.includes(item.person_empid)),
      ),
    ),
    get: jest.fn(() => {
      throw new Error('員編白名單的 worker 不得逐人查詢資格');
    }),
  };
  const policy = new MailRecipientPolicyService(
    mysql,
    new MailRecipientWhitelistRepository(),
    new FeastogetherDepartmentService(upstream as never),
    new FeastogetherHrService(upstream as never),
  );
  const adapter = new FakeInvitationMailSender();
  const sender = new GuardedInvitationMailSender(config, policy, adapter);
  const processor = new ExternalInvitationProcessor(
    mysql,
    notifications,
    new SignerRepository(),
    tokens,
    new EsignAuditService(auditRepository),
    sender,
  );
  const users = await manager.save(
    User,
    [0, 1, 2].map((index) =>
      manager.create(User, {
        empid: `WLUSER${index}`,
        name: '合成員工',
        isActive: true,
      }),
    ),
  );
  const rule = await manager.save(
    MailRecipientWhitelist,
    manager.create(MailRecipientWhitelist, {
      type: 'employee',
      value: 'WL0301',
      remark: '合成規則',
    }),
  );
  async function batch(
    kind: 'invitation' | 'reminder',
    emails: string[],
    signerType: 'user' | 'email' = 'user',
  ) {
    const document = await manager.save(
      EsignDocument,
      manager.create(EsignDocument, {
        docNumber: randomUUID(),
        title: '合成白名單文件',
        status: 'active',
        createdByUserId: users[0].id,
        signStartAt: new Date(Date.now() - 60_000),
        signEndAt: new Date(Date.now() + 86400_000),
      }),
    );
    const batch = await manager.save(
      EsignNotificationBatch,
      manager.create(EsignNotificationBatch, {
        documentId: document.id,
        kind,
        filterType: 'all',
        targetCount: emails.length,
      }),
    );
    for (const [index, email] of emails.entries()) {
      const invitation = tokens.createInvitationToken();
      const reminder = tokens.createInvitationToken();
      const signer = await manager.save(
        EsignSigner,
        manager.create(EsignSigner, {
          publicId: randomUUID(),
          documentId: document.id,
          signerType,
          email,
          nameSnapshot: '合成員工',
          ...(signerType === 'user'
            ? { userId: users[index].id, empidSnapshot: users[index].empid }
            : {
                invitationTokenSha256: invitation.digest,
                invitationTokenCiphertext: invitation.ciphertext,
                invitationExpiresAt: document.signEndAt,
              }),
        }),
      );
      await notifications.saveLog(
        notifications.createLog(
          {
            batchId: batch.id,
            signerId: signer.id,
            channel: 'email',
            ...(signerType === 'email'
              ? {
                  invitationGenerationSha256: invitation.digest,
                  reminderTokenCiphertext: reminder.ciphertext,
                  reminderTokenSha256: reminder.digest,
                  reminderExpiresAt: document.signEndAt,
                }
              : {}),
          },
          manager,
        ),
        manager,
      );
    }
    return {
      id: batch.id,
      logs: () => notifications.findBatchLogs(batch.id, manager),
      counts: () => notifications.batchCounts(batch.id, manager),
      events: () => auditRepository.findDocumentEvents(document.id, manager),
      run: async () => {
        const logs = await notifications.findBatchLogs(batch.id, manager);
        const data =
          signerType === 'user'
            ? { notificationBatchId: Number(batch.id) }
            : { notificationLogId: Number(logs[0].id) };
        await processor.process({ data } as Job<typeof data>);
      },
    };
  }
  return {
    manager,
    rule,
    adapter,
    sender,
    processor,
    upstream,
    notifications,
    batch,
    policy,
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function withFixture(run: (context: Fixture) => Promise<void>) {
  await withSchemaTestDatabase(async ({ database }) => {
    const ds = await new DataSource(
      buildMysqlOptions((key) =>
        key === 'DB_MYSQL_DB' ? database : process.env[key],
      ),
    ).initialize();
    try {
      await ds.runMigrations();
      await run(await fixture(ds));
    } finally {
      await ds.destroy();
    }
  });
}

describe('白名單群發與催簽完整 worker 路徑', () => {
  jest.setTimeout(60_000);
  afterEach(() => jest.restoreAllMocks());

  it('混合且重複地址只投遞允許信箱，逐人結果與批次總數收斂', async () => {
    await withFixture(async ({ batch, adapter }) => {
      const work = await batch('invitation', [
        'allowed@example.test',
        'blocked@example.test',
        'ALLOWED@example.test',
      ]);
      await work.run();
      expect(
        adapter.internalGroupDeliveries.map((mail) => mail.recipientEmails),
      ).toEqual([['allowed@example.test']]);
      const logs = await work.logs();
      expect(logs.map((log) => log.result)).toEqual([
        'delivered',
        'skipped',
        'delivered',
      ]);
      expect(logs[1]).toMatchObject({
        errorCode: 'MAIL_RECIPIENT_NOT_WHITELISTED',
        processingStartedAt: null,
        leaseToken: null,
        nextAttemptAt: null,
      });
      expect(logs[1].completedAt).toBeInstanceOf(Date);
      expect(logs[1].signer?.status).toBe('pending');
      expect(logs[1].signer?.invitationDeliveredAt).toBeNull();
      expect(await work.counts()).toEqual({ delivered: 2, skipped: 1 });
      expect((await work.events()).map((event) => event.eventType)).toEqual([
        'internal_invitation.delivered',
        'internal_invitation.delivered',
      ]);
    });
  });
  it('外部催簽被政策阻擋為 skipped，清除本次密文且不新增成功稽核', async () => {
    await withFixture(async ({ batch, adapter }) => {
      const work = await batch('reminder', ['blocked@example.test'], 'email');
      await work.run();
      expect(adapter.deliveries).toEqual([]);
      const [log] = await work.logs();
      expect(log).toMatchObject({
        result: 'skipped',
        errorCode: 'MAIL_RECIPIENT_NOT_WHITELISTED',
        attemptCount: 1,
        processingStartedAt: null,
        leaseToken: null,
        nextAttemptAt: null,
        reminderTokenCiphertext: null,
      });
      expect(log.completedAt).toBeInstanceOf(Date);
      expect(log.signer?.status).toBe('pending');
      expect(await work.events()).toEqual([]);
      await work.run();
      expect((await work.logs())[0].attemptCount).toBe(1);
    });
  });

  it('外部催簽命中信箱規則時人資來源故障仍 delivered 並寫入成功稽核', async () => {
    await withFixture(async ({ batch, adapter, manager, upstream }) => {
      await manager.save(
        MailRecipientWhitelist,
        manager.create(MailRecipientWhitelist, {
          type: 'email',
          value: 'external@example.test',
          remark: '合成信箱規則',
        }),
      );
      upstream.post.mockRejectedValue(new Error('合成來源故障'));
      const work = await batch('reminder', ['external@example.test'], 'email');
      await work.run();
      expect(upstream.post).not.toHaveBeenCalled();
      expect(adapter.deliveries).toEqual([
        expect.objectContaining({
          kind: 'reminder',
          recipientEmail: 'external@example.test',
        }),
      ]);
      expect((await work.logs())[0]).toMatchObject({
        result: 'delivered',
        errorCode: null,
        attemptCount: 1,
        processingStartedAt: null,
        leaseToken: null,
        nextAttemptAt: null,
      });
      expect(await work.counts()).toEqual({ delivered: 1 });
      expect((await work.events()).map((event) => event.eventType)).toEqual([
        'external_reminder.delivered',
      ]);
    });
  });

  it.each([
    ['invitation', 'user'],
    ['reminder', 'user'],
    ['reminder', 'email'],
  ] as const)(
    '%s/%s 檢查失敗最多三次，保留30/60秒退避且 recovery 不復活耗盡工作',
    async (kind, signerType) => {
      await withFixture(
        async ({ batch, adapter, upstream, notifications, manager }) => {
          const work = await batch(kind, ['allowed@example.test'], signerType);
          upstream.post.mockRejectedValue(
            new Error('合成上游秘密，不可寫入紀錄'),
          );
          for (const [index, delay] of [30_000, 60_000, null].entries()) {
            const before = Date.now();
            await work.run();
            const [log] = await work.logs();
            expect(log).toMatchObject({
              result: 'failed',
              errorCode: 'MAIL_WHITELIST_CHECK_FAILED',
              attemptCount: index + 1,
              processingStartedAt: null,
              leaseToken: null,
            });
            expect(log.completedAt).toBeInstanceOf(Date);
            if (delay !== null) {
              expect(log.nextAttemptAt?.getTime()).toBeGreaterThanOrEqual(
                before + delay,
              );
              expect(log.nextAttemptAt?.getTime()).toBeLessThanOrEqual(
                Date.now() + delay,
              );
              // 尚未到期的 queue 重送不可提早多做一次資格檢查。
              await work.run();
              expect((await work.logs())[0].attemptCount).toBe(index + 1);
              log.nextAttemptAt = new Date(Date.now() - 1);
              await notifications.saveLog(log, manager);
            } else {
              expect(log.nextAttemptAt).toBeNull();
              expect(log.reminderTokenCiphertext).toBeNull();
            }
          }
          upstream.post.mockClear();
          await work.run();
          expect(upstream.post).not.toHaveBeenCalled();
          expect(adapter.deliveries).toEqual([]);
          expect(adapter.internalGroupDeliveries).toEqual([]);
          expect(await work.events()).toEqual([]);
          expect(await work.counts()).toEqual({ failed: 1 });
          expect(
            await notifications.findEligibleInvitationLogIds(
              new Date(),
              new Date(Date.now() - 600_000),
              manager,
            ),
          ).toEqual([]);
        },
      );
    },
  );

  it.each(['user', 'email'] as const)(
    '%s 已排隊後撤銷全數跳過，恢復規則只影響明確新觸發',
    async (signerType) => {
      await withFixture(
        async ({ batch, rule, adapter, manager, notifications }) => {
          const work = await batch(
            'reminder',
            ['allowed@example.test'],
            signerType,
          );
          rule.deletedAt = new Date();
          await manager.save(rule);
          await work.run();
          expect(await work.counts()).toEqual({ skipped: 1 });
          expect((await work.logs())[0]).toMatchObject({
            errorCode: 'MAIL_RECIPIENT_NOT_WHITELISTED',
            attemptCount: 1,
            leaseToken: null,
            processingStartedAt: null,
            nextAttemptAt: null,
            reminderTokenCiphertext: null,
          });
          rule.deletedAt = null;
          await manager.save(rule);
          await work.run();
          expect((await work.logs())[0].attemptCount).toBe(1);
          expect(adapter.deliveries).toEqual([]);
          expect(adapter.internalGroupDeliveries).toEqual([]);
          expect(
            await notifications.findEligibleInvitationLogIds(
              new Date(),
              new Date(Date.now() - 600_000),
              manager,
            ),
          ).toEqual([]);
          const explicitlyTriggered = await batch(
            'reminder',
            ['allowed@example.test'],
            signerType,
          );
          await explicitlyTriggered.run();
          expect(await explicitlyTriggered.counts()).toEqual({ delivered: 1 });
        },
      );
    },
  );

  it('群發逐地址保留 unknown，新增規則不重送可能已受理的部分', async () => {
    await withFixture(async ({ batch, adapter, manager }) => {
      const sendGroup = jest
        .spyOn(adapter, 'sendInternalGroup')
        .mockResolvedValue([
          {
            recipientEmail: 'allowed@example.test',
            status: 'unknown',
            retryable: false,
          },
        ]);
      const work = await batch('invitation', [
        'allowed@example.test',
        'blocked@example.test',
      ]);
      await work.run();
      await manager.save(
        MailRecipientWhitelist,
        manager.create(MailRecipientWhitelist, {
          type: 'employee',
          value: 'WL0302',
          remark: '明確新增合成規則',
        }),
      );
      await work.run();
      expect(sendGroup).toHaveBeenCalledTimes(1);
      expect(await work.counts()).toEqual({ unknown: 1, skipped: 1 });
      expect(await work.events()).toEqual([]);
    });
  });

  it.each(['user', 'email'] as const)(
    '%s 舊租約回傳後不覆寫已退休工作或新世代',
    async (signerType) => {
      await withFixture(async ({ batch, adapter, manager, notifications }) => {
        const work = await batch(
          'reminder',
          ['allowed@example.test'],
          signerType,
        );
        const supersede = async () => {
          const [log] = await work.logs();
          log.result = 'failed';
          log.errorCode = 'INVITATION_SUPERSEDED';
          log.processingStartedAt = null;
          log.leaseToken = null;
          log.nextAttemptAt = null;
          log.reminderTokenCiphertext = null;
          await notifications.saveLog(log, manager);
        };
        if (signerType === 'user') {
          jest
            .spyOn(adapter, 'sendInternalGroup')
            .mockImplementation(async () => {
              await supersede();
              return [
                {
                  recipientEmail: 'allowed@example.test',
                  status: 'accepted',
                  retryable: false,
                },
              ];
            });
        } else {
          jest.spyOn(adapter, 'send').mockImplementation(supersede);
        }
        await work.run();
        expect((await work.logs())[0]).toMatchObject({
          result: 'failed',
          errorCode: 'INVITATION_SUPERSEDED',
          leaseToken: null,
        });
        expect(await work.events()).toEqual([]);
      });
    },
  );

  it('SMTP 實際 MIME 與 envelope 均只含允許且去重的收件地址', async () => {
    await withFixture(async ({ policy }) => {
      // stream transport 只在記憶體產生 MIME/envelope，不開任何 SMTP 連線。
      const stream = nodemailer.createTransport({
        streamTransport: true,
        buffer: true,
      });
      const messages: unknown[] = [];
      const sendMail = jest.fn(async (options: SendMailOptions) => {
        const message = await stream.sendMail(options);
        messages.push(message);
        return message;
      });
      jest
        .spyOn(nodemailer, 'createTransport')
        .mockReturnValue({ sendMail } as never);
      const config = new ConfigService({
        NODE_ENV: 'staging',
        SMTP_HOST: 'smtp.example.test',
        SMTP_PORT: 587,
        SMTP_SECURE: 'false',
        SMTP_FROM: 'sender@example.test',
        EXTERNAL_SIGNING_ORIGIN: 'https://sign.example.test',
      });
      const sender = new GuardedInvitationMailSender(
        config,
        policy,
        new SmtpInvitationMailSender(config),
      );
      const results = await sender.sendInternalGroup({
        recipientEmails: [
          'allowed@example.test',
          'blocked@example.test',
          ' ALLOWED@example.test ',
        ],
        documentTitle: '合成文件',
        creatorName: '合成建立人',
        signEndAt: new Date(Date.now() + 60_000),
        portalLoginUrl: 'https://portal.example.test',
      });
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(sendMail.mock.calls[0][0]).toMatchObject({
        bcc: ['allowed@example.test'],
      });
      expect(sendMail.mock.calls[0][0].to).toBeUndefined();
      expect(sendMail.mock.calls[0][0].cc).toBeUndefined();
      const message = messages[0];
      if (!message || typeof message !== 'object')
        throw new Error('缺少合成郵件');
      const envelope: unknown = Reflect.get(message, 'envelope');
      const mime: unknown = Reflect.get(message, 'message');
      if (!envelope || typeof envelope !== 'object' || !Buffer.isBuffer(mime))
        throw new Error('合成郵件格式錯誤');
      expect(Reflect.get(envelope, 'to')).toEqual(['allowed@example.test']);
      expect(mime.toString()).not.toMatch(/blocked@example\.test/i);
      expect(results).toContainEqual({
        recipientEmail: 'blocked@example.test',
        status: 'blocked',
        reasonCode: 'MAIL_RECIPIENT_NOT_WHITELISTED',
        retryable: false,
      });
    });
  });
  it.each(['user', 'email'] as const)(
    '%s 來源故障後每次重試重查規則，撤銷使下一次成為終止跳過',
    async (signerType) => {
      await withFixture(
        async ({ batch, rule, upstream, manager, notifications, adapter }) => {
          const work = await batch(
            'reminder',
            ['allowed@example.test'],
            signerType,
          );
          upstream.post.mockRejectedValueOnce(new Error('合成來源故障'));
          await work.run();
          const [retry] = await work.logs();
          expect(retry.errorCode).toBe('MAIL_WHITELIST_CHECK_FAILED');
          retry.nextAttemptAt = new Date(Date.now() - 1);
          await notifications.saveLog(retry, manager);
          rule.deletedAt = new Date();
          await manager.save(rule);
          await work.run();
          expect((await work.logs())[0]).toMatchObject({
            result: 'skipped',
            errorCode: 'MAIL_RECIPIENT_NOT_WHITELISTED',
            attemptCount: 2,
            nextAttemptAt: null,
          });
          expect(adapter.deliveries).toEqual([]);
          expect(adapter.internalGroupDeliveries).toEqual([]);
        },
      );
    },
  );
});
