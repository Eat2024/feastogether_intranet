import { AppErrorCode } from '#app/common/errors/app-error-code';
import type { PortalStaffRow } from '#app/infrastructure/portal/portal.types';
import { EligibleStaffService } from './eligible-staff.service';

const row = (override: Partial<PortalStaffRow> = {}): PortalStaffRow => ({
  person_empid: '000123',
  person_name: '王小明',
  department_id: 'D001',
  department_name: '資訊部',
  title: '工程師',
  person_status: 1,
  ...override,
});

describe('EligibleStaffService.lookupEligibleStaff', () => {
  const findEmployeesByEmpid = jest.fn<Promise<PortalStaffRow[]>, [string]>();
  const service = new EligibleStaffService({ findEmployeesByEmpid } as never);

  beforeEach(() => findEmployeesByEmpid.mockReset());

  it.each([
    { person_status: 0, person_status_name: '試用' },
    { person_status: 1, person_status_name: '正式' },
  ])(
    '以員編查 Portal，狀態 $person_status 回傳「$person_status_name」',
    async ({ person_status, person_status_name }) => {
      findEmployeesByEmpid.mockResolvedValue([row({ person_status })]);

      await expect(service.lookupEligibleStaff('000123')).resolves.toEqual({
        person_empid: '000123',
        person_name: '王小明',
        department_id: 'D001',
        department_name: '資訊部',
        title: '工程師',
        person_status,
        person_status_name,
      });
      expect(findEmployeesByEmpid).toHaveBeenCalledWith('000123');
    },
  );

  it('只計員編完全相同的試用／正式資料；其他狀態的同員編資料不影響', async () => {
    findEmployeesByEmpid.mockResolvedValue([
      row({ person_empid: '000123 ', person_name: '尾端空白' }),
      row({ person_empid: '000123', person_status: 2, person_name: '已離職' }),
      row({ person_name: '在職' }),
    ]);

    await expect(service.lookupEligibleStaff('000123')).resolves.toMatchObject({
      person_empid: '000123',
      person_name: '在職',
    });
  });

  it.each([
    { case: '查無', rows: [] },
    { case: '只有大小寫不同', rows: [row({ person_empid: 'e00123' })] },
    { case: '只有尾端空白不同', rows: [row({ person_empid: 'E00123 ' })] },
    {
      case: '同員編兩筆在職',
      rows: [
        row({ person_empid: 'E00123' }),
        row({ person_empid: 'E00123', person_status: 0 }),
      ],
    },
    {
      case: '狀態不是試用／正式',
      rows: [row({ person_empid: 'E00123', person_status: 2 })],
    },
  ])('$case → AUTH_EXCHANGE_FAILED', async ({ rows }) => {
    findEmployeesByEmpid.mockResolvedValue(rows);

    await expect(service.lookupEligibleStaff('E00123')).rejects.toMatchObject({
      code: AppErrorCode.AUTH_EXCHANGE_FAILED,
    });
  });

  it.each([
    { case: '姓名空白', override: { person_name: '  ' } },
    { case: '姓名超過 100 字', override: { person_name: '名'.repeat(101) } },
    { case: '部門代碼含非法字元', override: { department_id: 'D 01' } },
    { case: '部門代碼超過 50 字', override: { department_id: 'D'.repeat(51) } },
    {
      case: '部門名稱超過 150 字',
      override: { department_name: '部'.repeat(151) },
    },
    { case: '職稱超過 100 字', override: { title: '職'.repeat(101) } },
  ])('欄位不合法（$case）→ AUTH_EXCHANGE_FAILED', async ({ override }) => {
    findEmployeesByEmpid.mockResolvedValue([row(override)]);

    await expect(service.lookupEligibleStaff('000123')).rejects.toMatchObject({
      code: AppErrorCode.AUTH_EXCHANGE_FAILED,
    });
  });

  it('員編含非法字元 → AUTH_EXCHANGE_FAILED', async () => {
    findEmployeesByEmpid.mockResolvedValue([row({ person_empid: '00-123' })]);

    await expect(service.lookupEligibleStaff('00-123')).rejects.toMatchObject({
      code: AppErrorCode.AUTH_EXCHANGE_FAILED,
    });
  });

  it('Portal 查詢失敗 → STAFF_LOOKUP_FAILED，不帶出原始錯誤內容', async () => {
    findEmployeesByEmpid.mockRejectedValue(
      Object.assign(
        new Error("Access denied for user 'synthetic_reader'@'portal.invalid'"),
        { sql: "SELECT ... WHERE person_empid = '000123'" },
      ),
    );

    const error: unknown = await service
      .lookupEligibleStaff('000123')
      .catch((e: unknown) => e);

    expect(error).toMatchObject({
      code: AppErrorCode.STAFF_LOOKUP_FAILED,
      message: '系統有錯，請詢問IT部門',
    });
    expect(JSON.stringify(error)).not.toMatch(
      /synthetic_reader|portal\.invalid|000123/,
    );
  });

  it('Portal 的空字串欄位視為缺值、去除前後空白，與饗賓人同步後的資料相同', async () => {
    findEmployeesByEmpid.mockResolvedValue([
      row({
        person_name: ' 王小明 ',
        department_id: '',
        department_name: ' ',
        title: '',
      }),
    ]);

    await expect(service.lookupEligibleStaff('000123')).resolves.toEqual({
      person_empid: '000123',
      person_name: '王小明',
      department_id: null,
      department_name: null,
      title: null,
      person_status: 1,
      person_status_name: '正式',
    });
  });
});
