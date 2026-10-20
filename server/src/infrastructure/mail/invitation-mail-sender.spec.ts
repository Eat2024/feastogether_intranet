import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { buildInvitationMail, buildOtpMail } from './invitation-mail-content';
import { FakeInvitationMailSender } from './fake-invitation-mail-sender.service';
import { createInvitationMailSender } from './mail.module';
import { SmtpInvitationMailSender } from './smtp-invitation-mail-sender.service';

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail: jest.fn() })) },
}));

describe('Invitation mail sender', () => {
  const base = {
    recipientEmail: 'candidate@example.test',
    documentTitle: '聘僱合約',
    creatorName: '人資同仁',
    signEndAt: new Date('2026-10-20T08:00:00.000Z'),
    invitationToken: 'secret-token',
  };

  it('內容只含必要資訊、台北截止時間、固定 origin 與防轉寄提醒', () => {
    const mail = buildInvitationMail(base, 'https://sign.example.test');
    expect(mail.text).toContain('聘僱合約');
    expect(mail.text).toContain('人資同仁');
    expect(mail.text).toContain('簽署期限（台北時間）：2026/10/20 16:00');
    expect(mail.text).toContain(
      'https://sign.example.test/api/external-signature-invitations/secret-token',
    );
    expect(mail.text).toContain('請勿轉寄');
    expect(mail.text).not.toContain('其他簽署人');
  });

  it('驗證碼信只含驗證碼、10 分鐘有效、文件名稱與非本人操作提醒，不含任何連結', () => {
    const mail = buildOtpMail({
      recipientEmail: 'candidate@example.test',
      documentTitle: '聘僱合約 <附件&B>',
      code: '012345',
      validMinutes: 10,
    });
    expect(mail.subject).toBe('電子簽署驗證碼');
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain('012345');
      expect(body).toContain('10 分鐘內有效');
      expect(body).toContain('若非本人操作請忽略');
      expect(body).not.toMatch(/https?:|<a\b|href|www\./i);
      expect(body).not.toContain('candidate@example.test');
    }
    expect(mail.text).toContain('聘僱合約 <附件&B>');
    expect(mail.html).toContain('聘僱合約 &lt;附件&amp;B&gt;');
  });

  it('fake adapter 保留驗證碼信供 e2e 取得，與邀請信分開記錄', async () => {
    const sender = new FakeInvitationMailSender();
    const otp = {
      recipientEmail: 'candidate@example.test',
      documentTitle: '聘僱合約',
      code: '012345',
      validMinutes: 10,
    };
    await sender.sendOtp(otp);
    expect(sender.otpDeliveries).toEqual([otp]);
    expect(sender.deliveries).toEqual([]);
  });

  it('SMTP 寄出驗證碼信給指定收件人，不加入附件', async () => {
    const sender = new SmtpInvitationMailSender(
      new ConfigService({
        ESIGN_MAIL_DRIVER: 'smtp',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '1025',
        SMTP_SECURE: 'false',
        SMTP_FROM: 'no-reply@example.test',
        EXTERNAL_SIGNING_ORIGIN: 'https://sign.example.test',
      }),
    );
    await sender.sendOtp({
      recipientEmail: 'candidate@example.test',
      documentTitle: '聘僱合約',
      code: '012345',
      validMinutes: 10,
    });
    const transport = jest
      .mocked(nodemailer.createTransport)
      .mock.results.at(-1)?.value as { sendMail: jest.Mock };
    const [message] = transport.sendMail.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(message).toMatchObject({
      from: 'no-reply@example.test',
      to: 'candidate@example.test',
      subject: '電子簽署驗證碼',
    });
    expect(String(message.text)).toContain('012345');
    expect(message).not.toHaveProperty('attachments');
  });

  it.each([
    ['test', 'fake', FakeInvitationMailSender],
    ['development', 'smtp', SmtpInvitationMailSender],
    ['staging', 'smtp', SmtpInvitationMailSender],
    ['production', 'smtp', SmtpInvitationMailSender],
  ])('%s 使用 %s adapter', (_environment, driver, expected) => {
    const values: Record<string, string> = {
      ESIGN_MAIL_DRIVER: driver,
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '1025',
      SMTP_SECURE: 'false',
      SMTP_FROM: 'no-reply@example.test',
      EXTERNAL_SIGNING_ORIGIN: 'https://sign.example.test',
    };
    const sender = createInvitationMailSender(new ConfigService(values));
    expect(sender).toBeInstanceOf(expected);
  });

  it('SMTP 不加入附件並只投遞指定收件人', async () => {
    const config = new ConfigService({
      ESIGN_MAIL_DRIVER: 'smtp',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '1025',
      SMTP_SECURE: 'false',
      SMTP_FROM: 'no-reply@example.test',
      EXTERNAL_SIGNING_ORIGIN: 'https://sign.example.test',
    });
    const sender = new SmtpInvitationMailSender(config);
    await sender.send(base);
    const transport = jest
      .mocked(nodemailer.createTransport)
      .mock.results.at(-1)?.value as { sendMail: jest.Mock };
    expect(transport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'candidate@example.test' }),
    );
    const [message] = transport.sendMail.mock.calls[0] as [object];
    expect(message).not.toHaveProperty('attachments');
  });

  it.each([
    ['staging', 'false', { secure: false, requireTLS: true }],
    ['production', 'false', { secure: false, requireTLS: true }],
    ['production', 'true', { secure: true }],
    ['development', 'false', { secure: false, requireTLS: false }],
  ])(
    '%s 在 SMTP_SECURE=%s 時的連線加密：部署環境不允許明文送出帳密',
    (environment, secure, expected) => {
      new SmtpInvitationMailSender(
        new ConfigService({
          NODE_ENV: environment,
          SMTP_HOST: 'smtp.gmail.com',
          SMTP_PORT: '587',
          SMTP_SECURE: secure,
          SMTP_USER: 'sender@example.internal',
          SMTP_PASSWORD: 'not-a-real-app-password',
          SMTP_FROM: 'sender@example.internal',
          EXTERNAL_SIGNING_ORIGIN: 'https://sign.example.test',
        }),
      );
      expect(nodemailer.createTransport).toHaveBeenLastCalledWith(
        expect.objectContaining(expected),
      );
    },
  );

  it.each(['console', 'ses'])(
    '未知或已移除的 %s driver fail closed，不降級',
    (driver) => {
      expect(() =>
        createInvitationMailSender(
          new ConfigService({ ESIGN_MAIL_DRIVER: driver }),
        ),
      ).toThrow('ESIGN_MAIL_DRIVER 必須是 fake 或 smtp');
    },
  );
});
