import {
  cookieTokenFromHeader,
  cookieTokenFromMap,
} from './cookie-token.helper';

describe('cookie-token.helper', () => {
  it('從 Fastify cookies map 讀 token', () => {
    expect(
      cookieTokenFromMap({ APP_AUTH_TOKEN: 'token-1' }, 'APP_AUTH_TOKEN'),
    ).toBe('token-1');
  });

  it('cookies map 沒有指定 cookie 時回 null', () => {
    expect(cookieTokenFromMap({ other: 'x' }, 'APP_AUTH_TOKEN')).toBeNull();
  });

  it('從 raw cookie header 讀取並 decode token', () => {
    expect(
      cookieTokenFromHeader('x=1; APP_AUTH_TOKEN=token%2D1', 'APP_AUTH_TOKEN'),
    ).toBe('token-1');
  });

  it('raw cookie header 格式不合法時 fail closed', () => {
    expect(
      cookieTokenFromHeader('APP_AUTH_TOKEN=%zz', 'APP_AUTH_TOKEN'),
    ).toBeNull();
  });
});
