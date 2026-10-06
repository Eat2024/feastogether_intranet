import { apiErrorEnvelope, sendSocketError } from './api-error-response';

describe('api-error-response', () => {
  it('建立符合 HTTP 統一契約的失敗回應', () => {
    const body = apiErrorEnvelope({
      code: 'UNAUTHORIZED',
      message: '未登入',
      details: { reason: 'missing_token' },
    });

    expect(body).toMatchObject({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: '未登入',
        details: { reason: 'missing_token' },
      },
    });
    expect(body.timestamp).toEqual(expect.any(String));
  });

  it('details 未提供時不輸出空欄位', () => {
    expect(
      apiErrorEnvelope({ code: 'FORBIDDEN', message: '權限不足' }).error,
    ).not.toHaveProperty('details');
  });

  it('建立 socket ack 失敗回應，不混入 HTTP timestamp', () => {
    expect(sendSocketError('FORBIDDEN', '權限不足')).toEqual({
      success: false,
      error: { code: 'FORBIDDEN', message: '權限不足' },
    });
  });
});
