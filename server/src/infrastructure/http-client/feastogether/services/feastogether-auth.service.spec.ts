import { FeastogetherApiError } from '../feastogether.client';
import { FeastogetherAuthService } from './feastogether-auth.service';

describe('FeastogetherAuthService 帳密驗證', () => {
  const setup = () => {
    const client = {
      post: jest
        .fn()
        .mockResolvedValue({
          token: 'upstream-token',
          user: { person_empid: '00123' },
        }),
    };
    return { client, service: new FeastogetherAuthService(client as never) };
  };

  it('以原樣密碼呼叫上游；確認員編且不回傳 token', async () => {
    const { client, service } = setup();
    await expect(
      service.authenticate('00123', ' Mixed password '),
    ).resolves.toBeUndefined();
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/staff/login',
      { account_id: '00123', password: ' Mixed password ' },
      { timeoutMs: 10_000 },
    );
  });

  it.each([
    [401, 'INVALID_CREDENTIALS', 401],
    [403, 'ACCOUNT_DISABLED', 403],
    [500, 'EXTERNAL_AUTH_UNAVAILABLE', 502],
    [null, 'EXTERNAL_AUTH_UNAVAILABLE', 502],
  ])('上游 %s 的錯誤轉為固定訊息', async (status, code, expectedStatus) => {
    const { client, service } = setup();
    client.post.mockRejectedValue(
      new FeastogetherApiError(
        status as number | null,
        { secret: '不得揭露' },
        '不得揭露',
      ),
    );
    await expect(service.authenticate('00123', 'wrong')).rejects.toMatchObject({
      code,
      status: expectedStatus,
    });
  });

  it.each([
    null,
    {},
    { token: '' },
    { token: 'token', user: { person_empid: 'OTHER' } },
  ])('拒絕不完整或錯誤身分 %p', async (data) => {
    const { client, service } = setup();
    client.post.mockResolvedValue(data);
    await expect(
      service.authenticate('00123', 'password'),
    ).rejects.toMatchObject({ code: 'EXTERNAL_AUTH_UNAVAILABLE' });
  });
});
