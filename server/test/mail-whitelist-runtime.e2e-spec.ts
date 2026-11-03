import { User } from '#app/features/users/entities/user.entity';
import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import nodemailer from 'nodemailer';
import { AppModule } from '#app/app.module';
import { WorkerModule } from '#app/worker.module';
import { validateAppEnvironment } from '#app/config/app.environment';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { FeastogetherClient } from '#app/infrastructure/http-client/feastogether/feastogether.client';
import { FakeInvitationMailSender } from '#app/infrastructure/mail/fake-invitation-mail-sender.service';
import { GuardedInvitationMailSender } from '#app/infrastructure/mail/guarded-invitation-mail-sender.service';
import {
  INVITATION_MAIL_SENDER,
  type InvitationMailSender,
} from '#app/infrastructure/mail/invitation-mail-sender.port';
import { MailRecipientBlockedError } from '#app/infrastructure/mail/mail-recipient-policy.errors';
import { MailRecipientWhitelist } from '#app/infrastructure/mail/mail-recipient-whitelist.entity';
import { MailRecipientWhitelistRepository } from '#app/infrastructure/mail/mail-recipient-whitelist.repository';

/** 原生根模組驗證：不覆寫 sender、policy、repository 或 HR service。 */
describe.each([
  ['HTTP', AppModule],
  ['worker', WorkerModule],
] as const)('Spec018 %s 原生寄送模組', (_role, rootModule) => {
  it.each(['development', 'test', 'staging', 'production'])(
    '%s 的邀請、催簽、OTP 與群發均採相同環境政策',
    async (environment) => {
      const empid = `WIRE${randomBytes(4).toString('hex')}`;
      const allowedEmail = `${empid.toLowerCase()}@example.test`;
      const blockedEmail = 'unregistered@example.test';
      // 寄信白名單只讀本機資料：任何饗賓人呼叫（含 hr/*）都直接失敗，結尾另確認呼叫數為 0。
      const upstream = {
        get: jest.fn((path: string) => {
          throw new Error(`寄信白名單不得呼叫饗賓人 ${path}`);
        }),
        post: jest.fn((path: string) => {
          throw new Error(`寄信白名單不得呼叫饗賓人 ${path}`);
        }),
      };
      // Nodemailer 真正建立 envelope，傳輸層只在記憶體回報結果，不開 socket。
      const envelopes: string[][] = [];
      const capturedTransport = nodemailer.createTransport({
        name: '合成 SMTP',
        version: '1',
        send(message, complete) {
          const envelope = message.message.getEnvelope();
          envelopes.push(envelope.to);
          complete(null, {
            envelope,
            accepted: envelope.to,
            rejected: [],
          });
        },
      });
      const transportFactory = jest
        .spyOn(nodemailer, 'createTransport')
        .mockReturnValue(capturedTransport);
      const fakeSend = jest.spyOn(FakeInvitationMailSender.prototype, 'send');
      const fakeOtp = jest.spyOn(FakeInvitationMailSender.prototype, 'sendOtp');
      const fakeGroup = jest.spyOn(
        FakeInvitationMailSender.prototype,
        'sendInternalGroup',
      );
      // 以正式驗證器產生各環境合法設定；只覆寫環境依賴，保留原 MailModule factory。
      const config = new ConfigService(
        validateAppEnvironment({
          ...process.env,
          NODE_ENV: environment,
          ESIGN_MAIL_DRIVER: environment === 'test' ? 'fake' : 'smtp',
          ESIGN_STORAGE_DRIVER: environment === 'production' ? 's3' : 'local',
          ESIGN_STORAGE_ROOT: '/tmp/feastogether-intranet-runtime-test',
          ESIGN_S3_BUCKET: 'synthetic-runtime-bucket',
          AWS_REGION: 'ap-northeast-1',
          AWS_ACCESS_KEY_ID: undefined,
          AWS_SECRET_ACCESS_KEY: undefined,
          AWS_SESSION_TOKEN: undefined,
          EXTERNAL_SIGNING_ORIGIN: 'https://sign.example.test',
          SMTP_HOST: 'smtp.example.test',
          SMTP_PORT: '465',
          SMTP_SECURE: 'true',
          SMTP_FROM: 'sender@example.test',
          SMTP_USER: 'synthetic',
          SMTP_PASSWORD: 'synthetic',
        }),
      );
      const module = await Test.createTestingModule({ imports: [rootModule] })
        .overrideProvider(ConfigService)
        .useValue(config)
        .overrideProvider(FeastogetherClient)
        .useValue(upstream)
        .compile();
      const manager = module.get(MysqlService).getManager();
      let readRules: jest.SpyInstance | undefined;
      try {
        // compile 已建立完整原生 provider graph；不啟動 consumer 搶其他套件的佇列。
        const sender = module.get<InvitationMailSender>(INVITATION_MAIL_SENDER);
        expect(sender).toBeInstanceOf(GuardedInvitationMailSender);
        expect(() => module.get(FakeInvitationMailSender)).toThrow();
        await manager.insert(User, {
          empid,
          name: '合成白名單員工',
          email: allowedEmail,
          isActive: true,
        });
        const rule = await manager.save(
          MailRecipientWhitelist,
          manager.create(MailRecipientWhitelist, {
            type: 'employee',
            value: empid,
            remark: '原生模組合成測試',
          }),
        );
        if (environment === 'production') {
          readRules = jest
            .spyOn(
              module.get(MailRecipientWhitelistRepository),
              'findActiveRules',
            )
            .mockRejectedValue(new Error('合成 DB 故障'));
        }
        const invitation = {
          recipientEmail: allowedEmail,
          documentTitle: '合成環境矩陣文件',
          creatorName: '合成建立人',
          signEndAt: new Date(Date.now() + 3600_000),
          invitationToken: 'synthetic-invitation',
        };
        const otp = {
          recipientEmail: allowedEmail,
          documentTitle: invitation.documentTitle,
          code: '123456',
          validMinutes: 10,
        };
        await sender.send(invitation);
        await sender.send({ ...invitation, kind: 'reminder' });
        await sender.sendOtp(otp);
        const group = {
          recipientEmails: [allowedEmail, blockedEmail],
          documentTitle: invitation.documentTitle,
          creatorName: invitation.creatorName,
          signEndAt: invitation.signEndAt,
          portalLoginUrl: 'https://portal.example.test',
        };
        expect(await sender.sendInternalGroup(group)).toEqual([
          {
            recipientEmail: allowedEmail,
            status: 'accepted',
            retryable: false,
          },
          environment === 'production'
            ? {
                recipientEmail: blockedEmail,
                status: 'accepted',
                retryable: false,
              }
            : {
                recipientEmail: blockedEmail,
                status: 'blocked',
                reasonCode: 'MAIL_RECIPIENT_NOT_WHITELISTED',
                retryable: false,
              },
        ]);
        if (environment === 'production') {
          await sender.send({ ...invitation, recipientEmail: blockedEmail });
          await sender.sendOtp({ ...otp, recipientEmail: blockedEmail });
          expect(readRules).not.toHaveBeenCalled();
          expect(upstream.get).not.toHaveBeenCalled();
          expect(upstream.post).not.toHaveBeenCalled();
          expect(envelopes).toEqual([
            [allowedEmail],
            [allowedEmail],
            [allowedEmail],
            [allowedEmail, blockedEmail],
            [blockedEmail],
            [blockedEmail],
          ]);
        } else {
          await expect(
            sender.send({ ...invitation, recipientEmail: blockedEmail }),
          ).rejects.toBeInstanceOf(MailRecipientBlockedError);
          await expect(
            sender.sendOtp({ ...otp, recipientEmail: blockedEmail }),
          ).rejects.toBeInstanceOf(MailRecipientBlockedError);
          // 寄送入口每次讀資料，無需重新建立 module 即反映撤銷。
          rule.deletedAt = new Date();
          await manager.save(rule);
          await expect(sender.send(invitation)).rejects.toBeInstanceOf(
            MailRecipientBlockedError,
          );
          if (environment === 'test') {
            expect(fakeSend).toHaveBeenCalledTimes(2);
            expect(fakeOtp).toHaveBeenCalledTimes(1);
            expect(fakeGroup).toHaveBeenCalledWith({
              ...group,
              recipientEmails: [allowedEmail],
            });
            expect(envelopes).toEqual([]);
          } else {
            expect(envelopes).toEqual([
              [allowedEmail],
              [allowedEmail],
              [allowedEmail],
              [allowedEmail],
            ]);
            expect(fakeSend).not.toHaveBeenCalled();
          }
        }
        // 員編規則不需組織樹，也不得逐人查詢資格；所有寄送種類均適用。
        expect(upstream.get).not.toHaveBeenCalled();
        expect(upstream.post).not.toHaveBeenCalled();
      } finally {
        readRules?.mockRestore();
        await manager.delete(MailRecipientWhitelist, {
          type: 'employee',
          value: empid,
        });
        await manager.delete(User, { empid });
        await module.close();
        transportFactory.mockRestore();
        fakeSend.mockRestore();
        fakeOtp.mockRestore();
        fakeGroup.mockRestore();
      }
    },
    30_000,
  );
});
