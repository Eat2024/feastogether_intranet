import { of, throwError } from 'rxjs';
import { FeastogetherClient } from '../feastogether.client';
import { FeastogetherHrService } from './feastogether-hr.service';

function staffEmailSourceFixture() {
  const http = { get: jest.fn(), post: jest.fn() };
  const logger = { warn: jest.fn() };
  const client = new FeastogetherClient(
    http as never,
    {
      baseUrl: 'https://source.example.test',
      apiKey: 'synthetic-api-key',
    } as never,
    logger as never,
  );
  return { http, logger, hr: new FeastogetherHrService(client) };
}

describe('員工信箱來源傳輸', () => {
  it.each(
    [[], Array(101).fill('001'), ['A'.repeat(21)], ['001-1']].map((ids) => ({
      ids,
    })),
  )('不發送超過上游限制的查詢 %#', async ({ ids }: { ids: string[] }) => {
    const { hr, http } = staffEmailSourceFixture();
    await expect(hr.getStaffEmails(ids)).rejects.toMatchObject({
      status: 502,
    });
    expect(http.post).not.toHaveBeenCalled();
  });
  it.each([
    [],
    null,
    { data: [] },
    { success: 'true', data: [] },
    { success: false, code: 'sensitive@example.test', data: [] },
  ])('只接受成功 envelope，錯誤日誌無原始個資 %#', async (payload) => {
    const { hr, http, logger } = staffEmailSourceFixture();
    http.post.mockReturnValue(of({ data: payload }));
    await expect(hr.getStaffEmails(['001'])).rejects.toMatchObject({
      status: 502,
      code: 'ESIGN_EMPLOYEE_EMAIL_SOURCE_UNAVAILABLE',
    });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toMatch(
      /001|sensitive@example|requestBody|responseBody/,
    );
  });
  it.each([401, 403, 503, null])(
    'HTTP 錯誤／逾時轉 502 且不記錄 body：%s',
    async (status) => {
      const { hr, http, logger } = staffEmailSourceFixture();
      http.post.mockReturnValue(
        throwError(() => ({
          isAxiosError: true,
          name: 'AxiosError',
          response: { status, data: { email: 'sensitive@example.test' } },
        })),
      );
      await expect(hr.getStaffEmails(['001'])).rejects.toMatchObject({
        status: 502,
        code: 'ESIGN_EMPLOYEE_EMAIL_SOURCE_UNAVAILABLE',
      });
      expect(JSON.stringify(logger.warn.mock.calls)).not.toMatch(
        /001|sensitive@example|requestBody|responseBody|synthetic-api-key/,
      );
    },
  );
  it('用服務端 API Key 及 10 秒 timeout 取得解析結果，不傳員工 Bearer', async () => {
    const { hr, http } = staffEmailSourceFixture();
    http.post.mockReturnValue(
      of({
        data: {
          success: true,
          data: [{ person_empid: '001', email: 'A@example.test' }],
        },
      }),
    );
    await expect(hr.getStaffEmails(['001'])).resolves.toEqual(
      new Map([['001', 'a@example.test']]),
    );
    expect(http.post).toHaveBeenCalledWith(
      'https://source.example.test/api/v1/hr/staff_emails',
      { person_empids: ['001'] },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': 'synthetic-api-key',
        },
        timeout: 10000,
      },
    );
  });
});
