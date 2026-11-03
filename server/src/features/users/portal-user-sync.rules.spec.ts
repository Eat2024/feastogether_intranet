import type { PortalActiveEmployeeRow } from '#app/infrastructure/portal/portal.types';
import { User } from './entities/user.entity';
import {
  PORTAL_USER_DEACTIVATION_LIMIT,
  findDepartedEmpids,
  isDeactivationBlocked,
  normalizePortalEmployees,
  planPortalUserSync,
  summarizePortalUserSync,
} from './portal-user-sync.rules';

const row = (
  overrides: Partial<PortalActiveEmployeeRow> = {},
): PortalActiveEmployeeRow => ({
  person_empid: '00000001',
  person_name: '合成人員',
  department_id: 'D01',
  department_name: '合成部門',
  title: '職稱',
  email: 'a@example.test',
  person_status: 1,
  ...overrides,
});

describe('Portal 在職資料正規化', () => {
  it('保留前導零與 4-byte 中文，trim 後空白轉 null，email 轉小寫，狀態轉名稱', () => {
    const result = normalizePortalEmployees([
      row({
        person_name: ' 𠮷野堃喆 ',
        email: ' A@EXAMPLE.TEST ',
      }),
      row({
        person_empid: '00000002',
        person_name: '第二位',
        department_id: ' ',
        department_name: '',
        title: '  ',
        email: '',
        person_status: 0,
      }),
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.employees).toEqual([
      {
        empid: '00000001',
        name: '𠮷野堃喆',
        departmentCode: 'D01',
        departmentName: '合成部門',
        email: 'a@example.test',
        personStatus: '正式',
        titleName: '職稱',
      },
      {
        empid: '00000002',
        name: '第二位',
        departmentCode: null,
        departmentName: null,
        email: null,
        personStatus: '試用',
        titleName: null,
      },
    ]);
  });
});

describe('Portal 在職資料個別略過', () => {
  it.each([
    ['missing_name', row({ person_name: '  ' })],
    ['invalid_email', row({ email: 'not-an-email' })],
    ['too_long', row({ person_name: '字'.repeat(101) })],
    ['too_long', row({ department_id: 'D'.repeat(51) })],
    ['too_long', row({ department_name: '部'.repeat(151) })],
    ['too_long', row({ title: '職'.repeat(101) })],
    ['too_long', row({ email: `${'a'.repeat(250)}@x.test` })],
    ['invalid_empid', row({ person_empid: 'A-0001' })],
    ['invalid_empid', row({ person_empid: '' })],
    ['invalid_empid', row({ person_empid: '1'.repeat(21) })],
  ])('%s 只略過該員編，其他員工照常', (reason, invalid) => {
    const other = row({ person_empid: '00000009' });
    const result = normalizePortalEmployees([invalid, other]);
    expect(result.skipped).toEqual([{ empid: invalid.person_empid, reason }]);
    expect(result.employees.map((e) => e.empid)).toEqual(['00000009']);
  });

  it('長度以字元計：剛好 100 字的 4-byte 中文姓名可匯入', () => {
    const result = normalizePortalEmployees([
      row({ person_name: '𠮷'.repeat(100) }),
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.employees[0].name).toBe('𠮷'.repeat(100));
  });
});

describe('Portal 同員編重複與衝突', () => {
  it('完全相同（正規化後）的重複列合併成一位員工', () => {
    const result = normalizePortalEmployees([
      row(),
      row({ email: ' A@Example.TEST ' }),
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.employees).toHaveLength(1);
  });

  it.each([
    ['姓名不同', [row(), row({ person_name: '不同姓名' })]],
    ['試用與正式並存', [row(), row({ person_status: 0 })]],
    ['合法與不合法並存', [row(), row({ person_name: '' })]],
    ['不合法在前', [row({ person_name: '' }), row()]],
  ])('同員編資料不同（%s）只算一次 conflict', (_, rows) => {
    const result = normalizePortalEmployees([
      ...rows,
      row({ person_empid: '00000009' }),
    ]);
    expect(result.skipped).toEqual([{ empid: '00000001', reason: 'conflict' }]);
    expect(result.employees.map((e) => e.empid)).toEqual(['00000009']);
  });

  it('員編只差大小寫時兩個都算 conflict', () => {
    const result = normalizePortalEmployees([
      row({ person_empid: '00Ab1234' }),
      row({ person_empid: '00ab1234' }),
      row({ person_empid: '00000009' }),
    ]);
    expect(result.skipped).toEqual([
      { empid: '00Ab1234', reason: 'conflict' },
      { empid: '00ab1234', reason: 'conflict' },
    ]);
    expect(result.employees.map((e) => e.empid)).toEqual(['00000009']);
  });

  it('同員編的相同不合法列只計一次原因', () => {
    const result = normalizePortalEmployees([
      row({ person_name: '' }),
      row({ person_name: ' ' }),
    ]);
    expect(result.skipped).toEqual([
      { empid: '00000001', reason: 'missing_name' },
    ]);
  });
});

describe('Portal 明確非在職', () => {
  it('有資料列且沒有任何 0／1 的員編才算非在職；查詢期間恢復在職的不算', () => {
    expect(
      findDepartedEmpids([
        { person_empid: 'L0000001', person_status: 2 },
        { person_empid: 'L0000001', person_status: 4 },
        { person_empid: 'L0000002', person_status: 8 },
        { person_empid: 'L0000002', person_status: 1 },
        { person_empid: 'L0000003', person_status: 0 },
        { person_empid: 'L0000004', person_status: 99 },
      ]),
    ).toEqual(new Set(['L0000001', 'L0000004']));
  });
});

const local = (empid: string, overrides: Partial<User> = {}): User =>
  Object.assign(new User(), {
    id: Number(empid.slice(-4)),
    empid,
    name: '合成人員',
    departmentCode: 'D01',
    departmentName: '合成部門',
    email: 'a@example.test',
    personStatus: '正式',
    titleName: '職稱',
    isActive: true,
    deletedAt: null,
    ...overrides,
  });

describe('匯入分類', () => {
  const kinds = (plan: ReturnType<typeof planPortalUserSync>) =>
    plan.operations.map((op) => [
      op.kind,
      'fields' in op ? op.fields.empid : op.user.empid,
    ]);

  it('依本機狀態分成 create、update、noop、protected 與 deactivate', () => {
    const source = normalizePortalEmployees([
      row({ person_empid: 'P0000001' }),
      row({ person_empid: 'P0000002' }),
      row({ person_empid: 'P0000003', email: '' }),
      row({ person_empid: 'P0000004' }),
      row({ person_empid: 'P0000005' }),
    ]);
    const plan = planPortalUserSync(
      source,
      [
        local('P0000002'),
        local('P0000003'),
        local('P0000004', { isActive: false }),
        local('P0000005', { deletedAt: new Date() }),
        local('L0000001'),
        local('L0000002', { isActive: false }),
        local('L0000003', { deletedAt: new Date() }),
      ],
      new Set(['L0000001', 'L0000002', 'L0000003']),
    );
    expect(kinds(plan)).toEqual([
      ['create', 'P0000001'],
      ['noop', 'P0000002'],
      ['update', 'P0000003'],
      ['protected', 'P0000004'],
      ['protected', 'P0000005'],
      ['deactivate', 'L0000001'],
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it('任一欄位不同就是 update，包括清除信箱與 null 職稱', () => {
    for (const changed of [
      { name: '舊姓名' },
      { departmentCode: null },
      { departmentName: '舊部門' },
      { email: 'old@example.test' },
      { personStatus: '試用' },
      { titleName: undefined },
    ] as Partial<User>[]) {
      const plan = planPortalUserSync(
        normalizePortalEmployees([row({ person_empid: 'P0000001' })]),
        [local('P0000001', changed)],
        new Set(),
      );
      expect(plan.operations.map((op) => op.kind)).toEqual(['update']);
    }
  });

  it('被略過的員編與 Portal 查不到的本機員工都不出現在作業中', () => {
    const source = normalizePortalEmployees([
      row({ person_empid: 'P0000001', person_name: '' }),
    ]);
    const plan = planPortalUserSync(
      source,
      [local('P0000001'), local('N0000001')],
      new Set(),
    );
    expect(plan.operations).toEqual([]);
    expect(plan.skipped).toEqual([
      { empid: 'P0000001', reason: 'missing_name' },
    ]);
  });

  it('本機已有只差大小寫的員編時算 conflict，不建立也不更新', () => {
    const plan = planPortalUserSync(
      normalizePortalEmployees([row({ person_empid: '00AB1234' })]),
      [local('00ab1234')],
      new Set(),
    );
    expect(plan.operations).toEqual([]);
    expect(plan.skipped).toEqual([{ empid: '00AB1234', reason: 'conflict' }]);
  });
});

describe('停用門檻', () => {
  const departures = (count: number) => {
    const users = Array.from({ length: count }, (_, i) =>
      local(`L${String(i).padStart(7, '0')}`),
    );
    return planPortalUserSync(
      { employees: [], skipped: [] },
      users,
      new Set(users.map((u) => u.empid)),
    );
  };

  it('門檻是每次 500 人：剛好 500 人可套用，501 人被擋', () => {
    expect(PORTAL_USER_DEACTIVATION_LIMIT).toBe(500);
    expect(isDeactivationBlocked(departures(500))).toBe(false);
    expect(isDeactivationBlocked(departures(501))).toBe(true);
  });

  it('超過門檻時只有確認人數等於本次停用人數才放行', () => {
    const plan = departures(501);
    expect(isDeactivationBlocked(plan, 501)).toBe(false);
    expect(isDeactivationBlocked(plan, 500)).toBe(true);
    expect(isDeactivationBlocked(plan, 502)).toBe(true);
  });
});

describe('匯入結果摘要', () => {
  it('依分類計數，略過依原因計數，不含員編、姓名或 Email', () => {
    const rows = [
      row({ person_empid: 'P0000001', person_name: '新進甲' }),
      row({ person_empid: 'P0000002', email: 'secret@example.test' }),
      row({ person_empid: 'P0000003', person_name: '' }),
      row({ person_empid: 'P0000004', email: 'bad' }),
      row({ person_empid: 'P0000004', email: 'bad' }),
      row({ person_empid: 'BAD-0001' }),
    ];
    const plan = planPortalUserSync(
      normalizePortalEmployees(rows),
      [local('P0000002', { email: 'old@example.test' }), local('L0000001')],
      new Set(['L0000001']),
    );
    const summary = summarizePortalUserSync(plan, {
      trigger: 'schedule',
      sourceAcquiredAt: '2026-11-03T20:00:00.000Z',
      sourceRows: rows.length,
      outcome: 'applied',
    });
    expect(summary).toEqual({
      trigger: 'schedule',
      sourceAcquiredAt: '2026-11-03T20:00:00.000Z',
      sourceRows: 6,
      eligibleEmployees: 2,
      created: 1,
      updated: 1,
      unchanged: 0,
      protected: 0,
      deactivated: 1,
      skipped: {
        missing_name: 1,
        invalid_email: 1,
        too_long: 0,
        invalid_empid: 1,
        conflict: 0,
      },
      outcome: 'applied',
    });
    const text = JSON.stringify(summary);
    for (const secret of [
      'P000000',
      'L0000001',
      'BAD-0001',
      '新進甲',
      '合成人員',
      'example.test',
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});
