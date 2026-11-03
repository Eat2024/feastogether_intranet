import { MailRecipientPolicyService } from './mail-recipient-policy.service';
import { MailWhitelistCheckFailedError } from './mail-recipient-policy.errors';

function setup() {
  const rules = {
    findActiveRules: jest
      .fn()
      .mockResolvedValue([{ type: 'employee', value: 'S0001' }]),
  };
  const users = {
    findMailWhitelistEmails: jest
      .fn()
      .mockResolvedValue(['allowed@example.test']),
  };
  const manager = {};
  const service = new MailRecipientPolicyService(
    { getManager: () => manager } as never,
    rules,
    users as never,
  );
  return { service, rules, users, manager };
}

describe('本機寄信收件人政策', () => {
  it('以本機有效員工信箱比對，不信任未匹配地址', async () => {
    const { service, users, manager } = setup();
    await expect(
      service.allowedRecipients([
        'allowed@example.test',
        'forged@example.test',
      ]),
    ).resolves.toEqual(new Set(['allowed@example.test']));
    expect(users.findMailWhitelistEmails).toHaveBeenCalledWith(
      ['S0001'],
      [],
      manager,
    );
  });
  it('精確部門與員編規則分組送至repository，不展開子部門', async () => {
    const { service, rules, users, manager } = setup();
    rules.findActiveRules.mockResolvedValue([
      { type: 'department', value: 'D01' },
      { type: 'employee', value: 'S0001' },
    ]);
    await service.allowedRecipients(['allowed@example.test']);
    expect(users.findMailWhitelistEmails).toHaveBeenCalledWith(
      ['S0001'],
      ['D01'],
      manager,
    );
  });
  it('完整email規則全部命中即短路，users故障仍允許', async () => {
    const { service, rules, users } = setup();
    rules.findActiveRules.mockResolvedValue([
      { type: 'email', value: 'tester@example.test' },
      { type: 'employee', value: 'S0001' },
    ]);
    users.findMailWhitelistEmails.mockRejectedValue(new Error('DB秘密'));
    await expect(
      service.allowedRecipients(['tester@example.test']),
    ).resolves.toEqual(new Set(['tester@example.test']));
    expect(users.findMailWhitelistEmails).not.toHaveBeenCalled();
  });
  it('只有email規則時不允許同網域、plus或子網域近似地址', async () => {
    const { service, rules, users } = setup();
    rules.findActiveRules.mockResolvedValue([
      { type: 'email', value: 'tester@example.test' },
    ]);
    await expect(
      service.allowedRecipients([
        'tester@example.test',
        'tester+uat@example.test',
        'tester@sub.example.test',
        'other@example.test',
      ]),
    ).resolves.toEqual(new Set(['tester@example.test']));
    expect(users.findMailWhitelistEmails).not.toHaveBeenCalled();
  });
  it('本機與完整email規則取聯集，共用信箱只回傳一次', async () => {
    const { service, rules, users } = setup();
    rules.findActiveRules.mockResolvedValue([
      { type: 'email', value: 'tester@example.test' },
      { type: 'employee', value: 'S0001' },
    ]);
    users.findMailWhitelistEmails.mockResolvedValue([
      'allowed@example.test',
      'allowed@example.test',
      'unrequested@example.test',
    ]);
    await expect(
      service.allowedRecipients([
        'tester@example.test',
        'allowed@example.test',
      ]),
    ).resolves.toEqual(
      new Set(['tester@example.test', 'allowed@example.test']),
    );
  });
  it.each([{ emails: [] }, { emails: [null] }, { emails: [''] }])(
    '無可用員工信箱不放行 %#',
    async ({ emails }) => {
      const { service, users } = setup();
      users.findMailWhitelistEmails.mockResolvedValue(emails);
      await expect(
        service.allowedRecipients(['allowed@example.test']),
      ).resolves.toEqual(new Set());
    },
  );
  it('每次重新讀規則與本機信箱，更新後立即反映', async () => {
    const { service, rules, users } = setup();
    await expect(
      service.allowedRecipients(['allowed@example.test']),
    ).resolves.toEqual(new Set(['allowed@example.test']));
    users.findMailWhitelistEmails.mockResolvedValue(['new@example.test']);
    await expect(
      service.allowedRecipients(['allowed@example.test']),
    ).resolves.toEqual(new Set());
    rules.findActiveRules.mockResolvedValue([]);
    await expect(
      service.allowedRecipients(['new@example.test']),
    ).resolves.toEqual(new Set());
    expect(rules.findActiveRules).toHaveBeenCalledTimes(3);
    expect(users.findMailWhitelistEmails).toHaveBeenCalledTimes(2);
  });
  it('規則DB故障即失敗，即使完整email本來允許', async () => {
    const { service, rules } = setup();
    rules.findActiveRules.mockRejectedValue(new Error('SQL秘密'));
    await expect(
      service.allowedRecipients(['allowed@example.test']),
    ).rejects.toThrow('寄送白名單檢查失敗');
  });
  it('users DB故障不能傳回部分允許集合', async () => {
    const { service, rules, users } = setup();
    rules.findActiveRules.mockResolvedValue([
      { type: 'email', value: 'tester@example.test' },
      { type: 'employee', value: 'S0001' },
    ]);
    users.findMailWhitelistEmails.mockRejectedValue(new Error('SQL秘密'));
    await expect(
      service.allowedRecipients([
        'tester@example.test',
        'allowed@example.test',
      ]),
    ).rejects.toBeInstanceOf(MailWhitelistCheckFailedError);
  });
});
