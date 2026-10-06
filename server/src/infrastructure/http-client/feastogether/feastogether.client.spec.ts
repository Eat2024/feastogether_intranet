import { of, throwError } from 'rxjs';
import {
  FeastogetherApiError,
  FeastogetherClient,
} from './feastogether.client';

describe('FeastogetherClient logging', () => {
  const build = () => {
    const http = { get: jest.fn(), post: jest.fn() };
    const config = {
      baseUrl: 'https://upstream.example.com',
      apiKey: 'secret-api-key',
    };
    const logger = { warn: jest.fn() };
    return {
      client: new FeastogetherClient(
        http as never,
        config as never,
        logger as never,
      ),
      http,
      logger,
    };
  };

  it('HTTP 失敗時記錄遮罩後的 request／response body', async () => {
    const { client, http, logger } = build();
    const requestBody = {
      account_id: 'test-user',
      password: 'secret-password',
      verification_code: 'secret-code',
    };
    const upstreamBody = {
      accessToken: 'secret-response-token',
      password: 'secret-password',
    };
    http.post.mockReturnValue(
      throwError(() => ({
        isAxiosError: true,
        name: 'AxiosError',
        message: 'request failed with secret-response-token',
        response: { status: 503, data: upstreamBody },
      })),
    );

    await expect(
      client.post('/api/v1/staff/login', requestBody),
    ).rejects.toMatchObject({
      name: 'FeastogetherApiError',
      status: 503,
      body: upstreamBody,
    });

    expect(logger.warn).toHaveBeenCalledWith({
      event: 'feastogether.request_failed',
      message: '饗賓 API POST /api/v1/staff/login 失敗',
      context: FeastogetherClient.name,
      metadata: {
        method: 'post',
        path: '/api/v1/staff/login',
        status: 503,
        errorType: 'AxiosError',
        requestBody: {
          account_id: 'test-user',
          password: '***',
          verification_code: '***',
        },
        responseBody: {
          accessToken: '***',
          password: '***',
        },
      },
    });
  });

  it('logger 失敗時仍拋出原本的饗賓 API 錯誤', async () => {
    const { client, http, logger } = build();
    http.get.mockReturnValue(
      throwError(() => ({
        isAxiosError: true,
        name: 'AxiosError',
        message: 'upstream failed',
        response: { status: 502, data: null },
      })),
    );
    logger.warn.mockImplementation(() => {
      throw new Error('logger unavailable');
    });

    await expect(client.get('/api/v1/staff/card')).rejects.toBeInstanceOf(
      FeastogetherApiError,
    );
  });

  it('success=false 記錄 upstream code 與遮罩後的 response body', async () => {
    const { client, http, logger } = build();
    const upstreamBody = {
      success: false,
      code: 'INVALID_CREDENTIALS',
      message: '帳號或密碼錯誤',
      data: null,
    };
    http.get.mockReturnValue(of({ data: upstreamBody }));

    await expect(client.get('/api/v1/staff/login')).rejects.toMatchObject({
      name: 'FeastogetherApiError',
      body: upstreamBody,
    });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith({
      event: 'feastogether.request_failed',
      message: '饗賓 API GET /api/v1/staff/login 回傳 success=false',
      context: FeastogetherClient.name,
      metadata: {
        method: 'get',
        path: '/api/v1/staff/login',
        upstreamCode: 'INVALID_CREDENTIALS',
        responseBody: upstreamBody,
      },
    });
  });
});
