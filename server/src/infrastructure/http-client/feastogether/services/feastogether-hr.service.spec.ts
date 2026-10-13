import { AppErrorCode } from '#app/common/errors/app-error-code';
import { FeastogetherApiError } from '../feastogether.client';
import { FeastogetherHrService } from './feastogether-hr.service';

describe('FeastogetherHrService', () => {
  const build = () => {
    const client = { get: jest.fn(), post: jest.fn() };
    return { service: new FeastogetherHrService(client as never), client };
  };

  const range = { start_date: '2026-06-01', end_date: '2026-06-30' };

  it('lookupStaff：回傳員工查詢結果，查無資料回傳空陣列', async () => {
    const { service, client } = build();
    const first = {
      person_empid: '00115001',
      person_name: null,
      person_status: 1,
      person_status_name: '正式',
    };
    client.get.mockResolvedValue([
      first,
      { ...first, person_empid: '99115002' },
    ]);
    await expect(service.lookupStaff('11500')).resolves.toHaveLength(2);
    expect(client.get).toHaveBeenCalledWith(
      '/api/v1/hr/staff_lookup?person_empid=11500',
    );
    client.get.mockResolvedValue([first]);
    await expect(service.lookupStaff('00115001')).resolves.toHaveLength(1);
    expect(client.get).toHaveBeenLastCalledWith(
      '/api/v1/hr/staff_lookup?person_empid=00115001',
    );
    client.get.mockResolvedValue([]);
    await expect(service.lookupStaff('99999')).resolves.toEqual([]);
  });

  it('lookupStaff：上游失敗統一為 502，不觸發本系統登出', async () => {
    const { service, client } = build();
    client.get.mockRejectedValue(
      new FeastogetherApiError(403, {}, 'private details'),
    );
    await expect(service.lookupStaff('00115001')).rejects.toMatchObject({
      status: 502,
      message: '系統有錯，請詢問IT部門',
    });
  });

  it('lookupEligibleStaff 只接受唯一完整員編精確相符的合格資料', async () => {
    const { service, client } = build();
    const exact = {
      person_empid: '00123',
      person_name: '王小明',
      person_status: 1,
      person_status_name: '正式',
      department_id: 'D001',
      department_name: '資訊部',
      title: '工程師',
      ignored: '不應參與身分判斷',
    };
    client.get.mockResolvedValue([
      { ...exact, person_empid: '9900123' },
      exact,
    ]);
    const result = await service.lookupEligibleStaff('00123');
    expect(result).toMatchObject({
      person_empid: '00123',
      person_name: '王小明',
    });
    expect(result).not.toHaveProperty('ignored');
  });

  it.each([
    { rows: [] },
    { rows: [null] },
    {
      rows: [
        {
          person_empid: '00123',
          person_name: '王小明',
          person_status: 1,
          person_status_name: '正式',
        },
        {
          person_empid: '00123',
          person_name: '王小明',
          person_status: 1,
          person_status_name: '正式',
        },
      ],
    },
    {
      rows: [
        {
          person_empid: '00123',
          person_name: '',
          person_status: 1,
          person_status_name: '正式',
        },
      ],
    },
  ])(
    'lookupEligibleStaff 對零筆、多筆或格式錯誤 fail closed',
    async ({ rows }) => {
      const { service, client } = build();
      client.get.mockResolvedValue(rows);
      await expect(service.lookupEligibleStaff('00123')).rejects.toMatchObject({
        code: AppErrorCode.AUTH_EXCHANGE_FAILED,
        status: 401,
      });
    },
  );

  it('getShift：帶 Bearer token + 日期區間 query', async () => {
    const { service, client } = build();
    client.get.mockResolvedValue([]);

    await service.getShift('tok', range);

    expect(client.get).toHaveBeenCalledWith(
      '/api/v1/hr/shift?start_date=2026-06-01&end_date=2026-06-30',
      { token: 'tok' },
    );
  });

  it('getExamTicket / getCheckInLog：相同區間拼接', async () => {
    const { service, client } = build();
    client.get.mockResolvedValue([]);

    await service.getExamTicket('tok', range);
    await service.getCheckInLog('tok', range);

    expect(client.get).toHaveBeenNthCalledWith(
      1,
      '/api/v1/hr/exam_ticket?start_date=2026-06-01&end_date=2026-06-30',
      { token: 'tok' },
    );
    expect(client.get).toHaveBeenNthCalledWith(
      2,
      '/api/v1/hr/check_in_log?start_date=2026-06-01&end_date=2026-06-30',
      { token: 'tok' },
    );
  });

  it('getTeamMembers：帶 auth_code query', async () => {
    const { service, client } = build();
    client.get.mockResolvedValue([]);

    await service.getTeamMembers('tok', 'AC1');

    expect(client.get).toHaveBeenCalledWith(
      '/api/v1/hr/team_members?auth_code=AC1',
      { token: 'tok' },
    );
  });

  it('上游 401 → UNAUTHORIZED（token 失效）', async () => {
    const { service, client } = build();
    client.get.mockRejectedValue(new FeastogetherApiError(401, null, 'x'));

    await expect(service.getShift('tok', range)).rejects.toMatchObject({
      code: AppErrorCode.UNAUTHORIZED,
    });
  });
});
