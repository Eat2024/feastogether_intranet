import { throwError } from 'rxjs';
import {
  FeastogetherApiError,
  FeastogetherClient,
} from './feastogether.client';

describe('FeastogetherClient logging', () => {
  const build = () => {
    const http = { get: jest.fn() };
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
});
