import { MailRecipientPolicyService } from './mail-recipient-policy.service';
import { MailWhitelistCheckFailedError } from './mail-recipient-policy.errors';

function setup() {
  const rules = {
    findActive: jest
      .fn()
      .mockResolvedValue([{ type: 'employee', value: '09005001' }]),
  };
  const departments = { getOrgChart: jest.fn().mockResolvedValue([]) };
  const hr = {
    getStaffEmails: jest
      .fn()
      .mockResolvedValue(new Map([['09005001', 'allowed@example.test']])),
    lookupMailEligibleStaff: jest.fn().mockResolvedValue({
      status: 'eligible',
      staff: { person_empid: '09005001', department_id: null },
    }),
  };
  const service = new MailRecipientPolicyService(
    { getManager: () => ({}) } as never,
    rules as never,
    departments as never,
    hr as never,
  );
  return { service, rules, departments, hr };
}

describe('寄信收件人政策', () => {
  it.each(['ineligible', 'missing-email', 'unmatched-email'])(
    '員工規則不放行 %s 或相同網域其他地址',
    async (condition) => {
      const { service, hr } = setup();
      if (condition === 'ineligible')
        hr.lookupMailEligibleStaff.mockResolvedValue({ status: 'ineligible' });
      if (condition === 'missing-email')
        hr.getStaffEmails.mockResolvedValue(new Map([['09005001', null]]));
      if (condition === 'unmatched-email')
        hr.getStaffEmails.mockResolvedValue(
          new Map([['09005001', 'different@example.test']]),
        );
      await expect(
        service.allowedRecipients([
          'allowed@example.test',
          'other@example.test',
        ]),
      ).resolves.toEqual(new Set());
    },
  );

  it('追加規則後可寄、撤銷後阻擋；DB／組織／資格來源失敗都不回部分允許集合', async () => {
    const { service, rules, departments, hr } = setup();
    rules.findActive.mockResolvedValueOnce([]);
    await expect(
      service.allowedRecipients(['allowed@example.test']),
    ).resolves.toEqual(new Set());
    await expect(
      service.allowedRecipients(['allowed@example.test']),
    ).resolves.toEqual(new Set(['allowed@example.test']));
    rules.findActive.mockRejectedValueOnce(new Error('SQL秘密'));
    await expect(
      service.allowedRecipients(['allowed@example.test']),
    ).rejects.toThrow('寄送白名單檢查失敗');
    rules.findActive.mockResolvedValueOnce([
      { type: 'department', value: 'D01' },
    ]);
    departments.getOrgChart.mockRejectedValue(new Error('HR秘密'));
    await expect(
      service.allowedRecipients(['allowed@example.test']),
    ).rejects.toBeInstanceOf(MailWhitelistCheckFailedError);
    hr.lookupMailEligibleStaff.mockRejectedValue(new Error('歧義'));
    await expect(
      service.allowedRecipients(['allowed@example.test']),
    ).rejects.toBeInstanceOf(MailWhitelistCheckFailedError);
  });

  it('部門外的額外員編獨立允許，缺部門仍可依員編匹配且不查本機 User', async () => {
    const { service, rules, departments } = setup();
    rules.findActive.mockResolvedValue([
      { type: 'department', value: 'D01' },
      { type: 'employee', value: '09005001' },
    ]);
    departments.getOrgChart.mockResolvedValue([
      { department_ch_id: 'D01', employees: [], children: [] },
    ]);
    await expect(
      service.allowedRecipients(['allowed@example.test']),
    ).resolves.toEqual(new Set(['allowed@example.test']));
  });

  it('候選超過100人分批，資格最多4並行，同信箱歧義與來源故障整次不放行', async () => {
    const { service, rules, hr } = setup();
    const ids = Array.from({ length: 105 }, (_, i) =>
      String(i).padStart(5, '0'),
    );
    rules.findActive.mockResolvedValue(
      ids.map((value) => ({ type: 'employee', value })),
    );
    hr.getStaffEmails.mockImplementation((batch: string[]) => {
      if (batch.length > 100) throw new Error('批次超限');
      return Promise.resolve(
        new Map(batch.map((id) => [id, `${id}@example.test`])),
      );
    });
    let active = 0;
    let peak = 0;
    hr.lookupMailEligibleStaff.mockImplementation(async (id: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return {
        status: 'eligible',
        staff: { person_empid: id, department_id: null },
      };
    });
    const emails = ids.map((id) => `${id}@example.test`);
    await expect(service.allowedRecipients(emails)).resolves.toEqual(
      new Set(emails),
    );
    expect(
      hr.getStaffEmails.mock.calls.map(([batch]: [string[]]) => batch.length),
    ).toEqual([100, 5]);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
    rules.findActive.mockResolvedValue([
      { type: 'employee', value: '00001' },
      { type: 'employee', value: '00002' },
    ]);
    hr.getStaffEmails.mockResolvedValue(
      new Map([
        ['00001', 'shared@example.test'],
        ['00002', 'shared@example.test'],
      ]),
    );
    await expect(
      service.allowedRecipients(['shared@example.test']),
    ).rejects.toBeInstanceOf(MailWhitelistCheckFailedError);
    hr.getStaffEmails.mockRejectedValue(new Error('秘密來源內容'));
    await expect(service.allowedRecipients(emails)).rejects.toThrow(
      '寄送白名單檢查失敗',
    );
  });

  it('精確部門只收直接員工且重查目前部門，子部門與已轉出不能放行', async () => {
    const { service, rules, departments, hr } = setup();
    rules.findActive.mockResolvedValue([{ type: 'department', value: 'D01' }]);
    departments.getOrgChart.mockResolvedValue([
      {
        department_ch_id: 'ROOT',
        employees: [],
        children: [
          {
            department_ch_id: 'D01',
            employees: [{ person_empid: '0001' }, { person_empid: '0002' }],
            children: [
              {
                department_ch_id: 'D0101',
                employees: [{ person_empid: '0003' }],
                children: [],
              },
            ],
          },
        ],
      },
    ]);
    hr.getStaffEmails.mockResolvedValue(
      new Map([
        ['0001', 'one@example.test'],
        ['0002', 'two@example.test'],
      ]),
    );
    hr.lookupMailEligibleStaff.mockImplementation((id: string) =>
      Promise.resolve({
        status: 'eligible',
        staff: {
          person_empid: id,
          department_id: id === '0001' ? 'D01' : 'D02',
        },
      }),
    );
    await expect(
      service.allowedRecipients([
        'one@example.test',
        'two@example.test',
        'three@example.test',
      ]),
    ).resolves.toEqual(new Set(['one@example.test']));
    expect(hr.getStaffEmails).toHaveBeenCalledWith(['0001', '0002']);
  });

  it('完整員編規則允許可信信箱，撤銷後下一次立即阻擋且不查 HR', async () => {
    const { service, rules, hr } = setup();
    await expect(
      service.allowedRecipients(['allowed@example.test', 'other@example.test']),
    ).resolves.toEqual(new Set(['allowed@example.test']));
    rules.findActive.mockResolvedValue([]);
    await expect(
      service.allowedRecipients(['allowed@example.test']),
    ).resolves.toEqual(new Set());
    expect(hr.getStaffEmails).toHaveBeenCalledTimes(1);
    expect(hr.getStaffEmails).toHaveBeenCalledWith(['09005001']);
  });
});
