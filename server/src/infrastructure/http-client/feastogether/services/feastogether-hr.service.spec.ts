import { AppErrorCode } from '#app/common/errors/app-error-code';
import { FeastogetherApiError } from '../feastogether.client';
import { FeastogetherHrService } from './feastogether-hr.service';

describe('FeastogetherHrService', () => {
  const build = () => {
    const client = { get: jest.fn(), post: jest.fn() };
    return { service: new FeastogetherHrService(client as never), client };
  };

  const range = { start_date: '2026-06-01', end_date: '2026-06-30' };

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
