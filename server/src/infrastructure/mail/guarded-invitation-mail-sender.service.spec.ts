import { ConfigService } from '@nestjs/config';
import { GuardedInvitationMailSender } from './guarded-invitation-mail-sender.service';
import {
  MailRecipientBlockedError,
  MailWhitelistCheckFailedError,
} from './mail-recipient-policy.errors';
import type { SendInvitationMailInput } from './invitation-mail-sender.port';

const invitation: SendInvitationMailInput = {
  recipientEmail: 'allowed@example.test',
  documentTitle: '測試文件',
  creatorName: '測試人員',
  signEndAt: new Date('2030-01-01'),
  invitationToken: 'synthetic-token',
};
function setup(environment: unknown = 'test') {
  const policy = {
    allowedRecipients: jest
      .fn()
      .mockResolvedValue(new Set(['allowed@example.test'])),
  };
  const adapter = {
    send: jest.fn().mockResolvedValue(undefined),
    sendOtp: jest.fn().mockResolvedValue(undefined),
    sendInternalGroup: jest.fn().mockResolvedValue([]),
  };
  const sender = new GuardedInvitationMailSender(
    new ConfigService({ NODE_ENV: environment }),
    policy as never,
    adapter,
  );
  return { sender, policy, adapter };
}
describe('唯一公開寄信邊界', () => {
  const group = {
    documentTitle: '測試',
    creatorName: '測試',
    signEndAt: new Date('2030-01-01'),
    portalLoginUrl: 'https://portal.example.test',
    recipientEmails: [
      'allowed@example.test',
      'blocked@example.test',
      ' ALLOWED@example.test ',
    ],
  };
  it('群發僅傳允許且去重的地址，合併逐人結果，全阻擋不傳輸', async () => {
    const { sender, adapter, policy } = setup();
    adapter.sendInternalGroup.mockResolvedValue([
      {
        recipientEmail: 'allowed@example.test',
        status: 'accepted',
        retryable: false,
      },
    ]);
    await expect(sender.sendInternalGroup(group)).resolves.toEqual([
      {
        recipientEmail: 'allowed@example.test',
        status: 'accepted',
        retryable: false,
      },
      {
        recipientEmail: 'blocked@example.test',
        status: 'blocked',
        reasonCode: 'MAIL_RECIPIENT_NOT_WHITELISTED',
        retryable: false,
      },
    ]);
    expect(adapter.sendInternalGroup).toHaveBeenCalledWith({
      ...group,
      recipientEmails: ['allowed@example.test'],
    });
    policy.allowedRecipients.mockResolvedValue(new Set());
    await sender.sendInternalGroup(group);
    expect(adapter.sendInternalGroup).toHaveBeenCalledTimes(1);
  });
  it('群發來源故障不能用部分解析結果寄送，缺漏或重複 adapter 結果為 unknown', async () => {
    const { sender, adapter, policy } = setup();
    policy.allowedRecipients.mockRejectedValue(
      new MailWhitelistCheckFailedError(),
    );
    const results = await sender.sendInternalGroup(group);
    expect(results).toHaveLength(2);
    expect(
      results.every(
        (result) =>
          result.status === 'check-failed' &&
          result.reasonCode === 'MAIL_WHITELIST_CHECK_FAILED',
      ),
    ).toBe(true);
    expect(adapter.sendInternalGroup).not.toHaveBeenCalled();
    policy.allowedRecipients.mockResolvedValue(
      new Set(['allowed@example.test']),
    );
    const duplicate = {
      recipientEmail: 'allowed@example.test',
      status: 'accepted',
      retryable: false,
    };
    adapter.sendInternalGroup.mockResolvedValue([duplicate, duplicate]);
    expect((await sender.sendInternalGroup(group))[0]).toEqual({
      recipientEmail: 'allowed@example.test',
      status: 'unknown',
      retryable: false,
    });
  });

  it('production 不執行白名單查詢且 SMTP 原始錯誤保持原樣', async () => {
    const { sender, policy, adapter } = setup('production');
    policy.allowedRecipients.mockRejectedValue(new Error('不應查詢'));
    await sender.send(invitation);
    expect(policy.allowedRecipients).not.toHaveBeenCalled();
    const smtpError = new Error('傳輸故障');
    adapter.send.mockRejectedValue(smtpError);
    await expect(sender.send(invitation)).rejects.toBe(smtpError);
  });

  it.each([null, '', 'Production', 'unknown', ' production '])(
    '非法環境 %s 拒絕傳輸',
    async (env) => {
      const { sender, adapter, policy } = setup(env);
      await expect(sender.send(invitation)).rejects.toBeInstanceOf(
        MailWhitelistCheckFailedError,
      );
      expect(policy.allowedRecipients).not.toHaveBeenCalled();
      expect(adapter.send).not.toHaveBeenCalled();
    },
  );

  it.each([
    'evil@example.test,allowed@example.test',
    'Name <allowed@example.test>',
    'allowed@example.test\r\nBcc: evil@example.test',
  ])('不解析可能增加 envelope 的地址 %s', async (email) => {
    const { sender, adapter } = setup();
    await expect(
      sender.send({ ...invitation, recipientEmail: email }),
    ).rejects.toBeInstanceOf(MailRecipientBlockedError);
    expect(adapter.send).not.toHaveBeenCalled();
  });

  it('單一地址正規化後核對並將相同地址交付 adapter', async () => {
    const { sender, adapter, policy } = setup();
    await sender.send({
      ...invitation,
      recipientEmail: ' Allowed@Example.Test ',
    });
    expect(policy.allowedRecipients).toHaveBeenCalledWith([
      'allowed@example.test',
    ]);
    expect(adapter.send).toHaveBeenCalledWith(invitation);
  });

  it.each(['development', 'test', 'staging'])(
    '%s 邀請及 OTP 只允許可信地址，阻擋不冒充成功',
    async (env) => {
      const { sender, adapter } = setup(env);
      await sender.send(invitation);
      expect(adapter.send).toHaveBeenCalledWith(invitation);
      await expect(
        sender.send({ ...invitation, recipientEmail: 'other@example.test' }),
      ).rejects.toBeInstanceOf(MailRecipientBlockedError);
      await expect(
        sender.sendOtp({
          recipientEmail: 'other@example.test',
          documentTitle: '測試',
          code: '123456',
          validMinutes: 5,
        }),
      ).rejects.toBeInstanceOf(MailRecipientBlockedError);
      expect(adapter.send).toHaveBeenCalledTimes(1);
      expect(adapter.sendOtp).not.toHaveBeenCalled();
    },
  );
});
