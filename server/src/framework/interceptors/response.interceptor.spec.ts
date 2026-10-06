import { ExecutionContext, CallHandler } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';

const makeContext = (): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ url: '/api/x', headers: {} }),
    }),
  }) as unknown as ExecutionContext;

describe('ResponseInterceptor', () => {
  it('成功回應使用固定格式且不包含 path', async () => {
    const interceptor = new ResponseInterceptor();
    const next: CallHandler = { handle: () => of({ ok: true }) };

    const body = await lastValueFrom(
      interceptor.intercept(makeContext(), next),
    );

    expect(body).toMatchObject({
      success: true,
      data: { ok: true },
    });
    expect(body).toHaveProperty('timestamp');
    expect(body).not.toHaveProperty('path');
  });
});
