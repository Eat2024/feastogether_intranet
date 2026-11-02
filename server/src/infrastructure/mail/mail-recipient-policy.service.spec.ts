import { FeastogetherHrService } from '#app/infrastructure/http-client/feastogether/services/feastogether-hr.service';
import { MailRecipientPolicyService } from './mail-recipient-policy.service';
import { MailWhitelistCheckFailedError } from './mail-recipient-policy.errors';

function setup() {
  const rules = {
    findActiveRules: jest
      .fn()
      .mockResolvedValue([{ type: 'employee', value: '09005001' }]),
  };
  const departments = { getOrgChart: jest.fn().mockResolvedValue([]) };
  const upstream = {
    get: jest.fn(() => {
      throw new Error('白名單不得逐人查詢資格或部門');
    }),
    post: jest
      .fn()
      .mockResolvedValue([
        { person_empid: '09005001', email: 'allowed@example.test' },
      ]),
  };
  const service = new MailRecipientPolicyService(
    { getManager: () => ({}) } as never,
    rules,
    departments as never,
    new FeastogetherHrService(upstream as never),
  );
  return { service, rules, departments, upstream };
}

describe('寄信收件人政策', () => {
  it('額外員編只需可信信箱，資格來源不可用仍允許，不查組織樹或逐人資格', async () => {
    const { service, departments, upstream } = setup();
    await expect(
      service.allowedRecipients(['allowed@example.test', 'other@example.test']),
    ).resolves.toEqual(new Set(['allowed@example.test']));
    expect(departments.getOrgChart).not.toHaveBeenCalled();
    expect(upstream.get).not.toHaveBeenCalled();
    expect(upstream.post).toHaveBeenCalledWith(
      '/api/v1/hr/staff_emails',
      { person_empids: ['09005001'] },
      { timeoutMs: 10_000 },
    );
  });

  it.each([{ rows: [] }, { rows: [{ person_empid: '09005001', email: '' }] }])(
    '沒有可信有效信箱時不放行：%j',
    async ({ rows }) => {
      const { service, upstream } = setup();
      upstream.post.mockResolvedValue(rows);
      await expect(
        service.allowedRecipients(['allowed@example.test']),
      ).resolves.toEqual(new Set());
      expect(upstream.get).not.toHaveBeenCalled();
    },
  );

  it('同公司網域或 caller 聲稱不能讓未匹配地址進入允許集合', async () => {
    const { service, upstream } = setup();
    await expect(
      service.allowedRecipients(['forged@example.test']),
    ).resolves.toEqual(new Set());
    expect(upstream.get).not.toHaveBeenCalled();
  });

  it('每次重讀規則，新增可寄、撤銷後立即阻擋；空規則不查 HR', async () => {
    const { service, rules, departments, upstream } = setup();
    rules.findActiveRules.mockResolvedValueOnce([]);
    await expect(
      service.allowedRecipients(['allowed@example.test']),
    ).resolves.toEqual(new Set());
    expect(upstream.post).not.toHaveBeenCalled();
    await expect(
      service.allowedRecipients(['allowed@example.test']),
    ).resolves.toEqual(new Set(['allowed@example.test']));
    rules.findActiveRules.mockResolvedValueOnce([]);
    await expect(
      service.allowedRecipients(['allowed@example.test']),
    ).resolves.toEqual(new Set());
    expect(rules.findActiveRules).toHaveBeenCalledTimes(3);
    expect(upstream.post).toHaveBeenCalledTimes(1);
    expect(departments.getOrgChart).not.toHaveBeenCalled();
    expect(upstream.get).not.toHaveBeenCalled();
  });

  it('精確部門只收直接員工，額外員編獨立加入，不另查目前部門', async () => {
    const { service, rules, departments, upstream } = setup();
    rules.findActiveRules.mockResolvedValue([
      { type: 'department', value: 'D01' },
      { type: 'employee', value: '09005001' },
    ]);
    departments.getOrgChart.mockResolvedValue([
      {
        department_ch_id: 'ROOT',
        employees: [{ person_empid: 'ROOT01' }],
        children: [
          {
            department_ch_id: 'D01',
            employees: [{ person_empid: '0001' }, { person_empid: '09005001' }],
            children: [
              {
                department_ch_id: 'D0101',
                employees: [{ person_empid: '0002' }],
                children: [],
              },
            ],
          },
        ],
      },
    ]);
    upstream.post.mockResolvedValue([
      { person_empid: '09005001', email: 'allowed@example.test' },
      { person_empid: '0001', email: 'one@example.test' },
    ]);
    await expect(
      service.allowedRecipients([
        'allowed@example.test',
        'one@example.test',
        'two@example.test',
      ]),
    ).resolves.toEqual(new Set(['allowed@example.test', 'one@example.test']));
    expect(upstream.post).toHaveBeenCalledWith(
      '/api/v1/hr/staff_emails',
      { person_empids: ['09005001', '0001'] },
      { timeoutMs: 10_000 },
    );
    expect(departments.getOrgChart).toHaveBeenCalledTimes(1);
    expect(upstream.get).not.toHaveBeenCalled();
    // 組織樹移除直接員工後，下次檢查只剩額外允許員編。
    departments.getOrgChart.mockResolvedValue([]);
    upstream.post.mockResolvedValue([
      { person_empid: '09005001', email: 'allowed@example.test' },
    ]);
    await expect(
      service.allowedRecipients(['allowed@example.test', 'one@example.test']),
    ).resolves.toEqual(new Set(['allowed@example.test']));
  });

  it.each([101, 300])(
    '候選 %i 人時按100人分批，不因收件人數追加逐人請求',
    async (count) => {
      const { service, rules, departments, upstream } = setup();
      const ids = Array.from({ length: count }, (_, i) =>
        String(i).padStart(5, '0'),
      );
      rules.findActiveRules.mockResolvedValue([
        { type: 'department', value: 'D01' },
      ]);
      departments.getOrgChart.mockResolvedValue([
        {
          department_ch_id: 'D01',
          employees: ids.map((person_empid) => ({ person_empid })),
          children: [],
        },
      ]);
      upstream.post.mockImplementation(
        (_path: string, body: { person_empids: string[] }) =>
          Promise.resolve(
            body.person_empids.map((person_empid) => ({
              person_empid,
              email: `${person_empid}@example.test`,
            })),
          ),
      );
      const emails = ids.slice(0, 50).map((id) => `${id}@example.test`);
      await expect(service.allowedRecipients(emails)).resolves.toEqual(
        new Set(emails),
      );
      expect(rules.findActiveRules).toHaveBeenCalledTimes(1);
      expect(departments.getOrgChart).toHaveBeenCalledTimes(1);
      expect(
        upstream.post.mock.calls.map(
          ([, body]: [string, { person_empids: string[] }]) =>
            body.person_empids.length,
        ),
      ).toEqual(count === 101 ? [100, 1] : [100, 100, 100]);
      expect(upstream.get).not.toHaveBeenCalled();
    },
  );

  it.each([2, 101])(
    '%i 個候選員編共用信箱時只保留一個地址，跨批次亦去重',
    async (count) => {
      const { service, rules, upstream } = setup();
      const ids = Array.from({ length: count }, (_, index) =>
        String(index).padStart(5, '0'),
      );
      rules.findActiveRules.mockResolvedValue(
        ids.map((value) => ({ type: 'employee', value })),
      );
      upstream.post.mockImplementation(
        (_path: string, body: { person_empids: string[] }) =>
          Promise.resolve(
            body.person_empids.map((person_empid) => ({
              person_empid,
              email: 'shared@example.test',
            })),
          ),
      );
      await expect(
        service.allowedRecipients([
          'shared@example.test',
          'other@example.test',
        ]),
      ).resolves.toEqual(new Set(['shared@example.test']));
      expect(upstream.post).toHaveBeenCalledTimes(Math.ceil(count / 100));
      expect(upstream.get).not.toHaveBeenCalled();
    },
  );

  it('必要來源故障不放行，也不回傳先前批次已解析的部分名單', async () => {
    const { service, rules, departments, upstream } = setup();
    rules.findActiveRules.mockRejectedValueOnce(new Error('SQL秘密'));
    await expect(
      service.allowedRecipients(['allowed@example.test']),
    ).rejects.toThrow('寄送白名單檢查失敗');
    rules.findActiveRules.mockResolvedValueOnce([
      { type: 'department', value: 'D01' },
    ]);
    departments.getOrgChart.mockRejectedValueOnce(new Error('HR秘密'));
    await expect(
      service.allowedRecipients(['allowed@example.test']),
    ).rejects.toBeInstanceOf(MailWhitelistCheckFailedError);
    rules.findActiveRules.mockResolvedValue(
      Array.from({ length: 101 }, (_, i) => ({
        type: 'employee',
        value: String(i).padStart(5, '0'),
      })),
    );
    upstream.post
      .mockResolvedValueOnce([
        { person_empid: '00000', email: 'allowed@example.test' },
      ])
      .mockRejectedValueOnce(new Error('HR秘密'));
    await expect(
      service.allowedRecipients(['allowed@example.test']),
    ).rejects.toThrow('寄送白名單檢查失敗');
    expect(upstream.get).not.toHaveBeenCalled();
  });
});
