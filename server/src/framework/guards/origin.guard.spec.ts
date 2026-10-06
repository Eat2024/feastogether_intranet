import type { ExecutionContext } from '@nestjs/common';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { OriginGuard } from './origin.guard';

const contextWithOrigin = (origin?: string): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers: origin === undefined ? {} : { origin } }),
    }),
  }) as unknown as ExecutionContext;

const makeGuard = (corsOrigin: string | undefined, trustedOrigins?: string) =>
  new OriginGuard({
    get: (key: string) =>
      key === 'AUTH_TRUSTED_ORIGINS' ? trustedOrigins : corsOrigin,
  } as never);

describe('OriginGuard', () => {
  it('Origin 在允許清單（逗號分隔多值）→ 放行', () => {
    const guard = makeGuard('http://localhost:3000, https://app.example.com');

    expect(
      guard.canActivate(contextWithOrigin('https://app.example.com')),
    ).toBe(true);
  });

  it('Origin 不在清單 → 403 CSRF_ORIGIN_REJECTED', () => {
    const guard = makeGuard('http://localhost:3000');

    expect(() =>
      guard.canActivate(contextWithOrigin('https://evil.example.com')),
    ).toThrow(
      expect.objectContaining({ code: AppErrorCode.CSRF_ORIGIN_REJECTED }),
    );
  });

  it('Origin 為 "null"（沙箱／跨站 redirect）→ 拒絕', () => {
    const guard = makeGuard('http://localhost:3000');

    expect(() => guard.canActivate(contextWithOrigin('null'))).toThrow();
  });

  it('AUTH_TRUSTED_ORIGINS 優先於 CORS_ORIGIN；兩者皆空 → 帶 Origin 一律拒絕（fail closed）', () => {
    const trusted = makeGuard(
      'http://localhost:3000',
      'https://app.example.com',
    );
    expect(
      trusted.canActivate(contextWithOrigin('https://app.example.com')),
    ).toBe(true);
    expect(() =>
      trusted.canActivate(contextWithOrigin('http://localhost:3000')),
    ).toThrow();
    expect(() =>
      makeGuard(undefined).canActivate(
        contextWithOrigin('http://localhost:3000'),
      ),
    ).toThrow();
  });

  it('未帶 Origin → 放行（SameSite=Lax 為主防線）', () => {
    expect(
      makeGuard('http://localhost:3000').canActivate(contextWithOrigin()),
    ).toBe(true);
  });
});
