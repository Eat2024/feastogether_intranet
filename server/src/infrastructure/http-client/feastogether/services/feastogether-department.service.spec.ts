import { AppErrorCode } from '#app/common/errors/app-error-code';
import { FeastogetherApiError } from '../feastogether.client';
import { FeastogetherDepartmentService } from './feastogether-department.service';

describe('FeastogetherDepartmentService', () => {
  const build = () => {
    const client = { get: jest.fn(), post: jest.fn() };
    return {
      service: new FeastogetherDepartmentService(client as never),
      client,
    };
  };

  it('getAllDepartment：打 all_department 並回傳 data', async () => {
    const { service, client } = build();
    const data = [{ dep_code: 'D1', dep_name: '門市' }];
    client.get.mockResolvedValue(data);

    await expect(service.getAllDepartment()).resolves.toBe(data);
    expect(client.get).toHaveBeenCalledWith('/api/v1/staff/all_department');
  });

  it('getAllSearchDepartment：打 all_search_department 並回傳 data', async () => {
    const { service, client } = build();
    const data = [{ category_id: 'c1' }];
    client.get.mockResolvedValue(data);

    await expect(service.getAllSearchDepartment()).resolves.toBe(data);
    expect(client.get).toHaveBeenCalledWith(
      '/api/v1/staff/all_search_department',
    );
  });

  it('上游錯誤 → 轉本系統 error code（不外露上游）', async () => {
    const { service, client } = build();
    client.get.mockRejectedValue(new FeastogetherApiError(503, null, 'x'));

    await expect(service.getAllDepartment()).rejects.toMatchObject({
      code: AppErrorCode.EATOGETHER_API_SERVICE_UNAVAILABLE,
    });
  });
  it('組織樹合法空陣列保留，指定 timeout 且不帶 token', async () => {
    const { service, client } = build();
    client.get.mockResolvedValue([]);
    await expect(service.getOrgChart()).resolves.toEqual([]);
    expect(client.get).toHaveBeenCalledWith('/api/v1/hr/org_chart', {
      timeoutMs: 10_000,
    });
  });
  it('組織樹必要欄位錯誤整批回 502', async () => {
    const { service, client } = build();
    client.get.mockResolvedValue([{ department_ch_id: '001' }]);
    await expect(service.getOrgChart()).rejects.toMatchObject({
      code: 'ORG_CHART_UPSTREAM_UNAVAILABLE',
    });
  });

  it.each([401, 403, 500, null])(
    '組織樹上游 %s 均映射為 502，不觸發使用者登出',
    async (status) => {
      const { service, client } = build();
      client.get.mockRejectedValue(
        new FeastogetherApiError(status, { private: 'synthetic' }, 'synthetic'),
      );
      await expect(service.getOrgChart()).rejects.toMatchObject({
        code: 'ORG_CHART_UPSTREAM_UNAVAILABLE',
        status: 502,
      });
    },
  );
  it('HTTP 逾時錯誤回傳 502', async () => {
    const { service, client } = build();
    client.get.mockRejectedValue(
      new FeastogetherApiError(null, null, '連線逾時'),
    );
    await expect(service.getOrgChart()).rejects.toMatchObject({
      code: 'ORG_CHART_UPSTREAM_UNAVAILABLE',
      status: 502,
    });
  });
});
