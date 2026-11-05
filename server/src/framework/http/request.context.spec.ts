import { getRequestPath } from './request.context';

describe('getRequestPath', () => {
  it.each(['external-signature-invitations', 'signature-verifications'])(
    '%s path 一律遮蔽 bearer token',
    (resource) => {
      expect(
        getRequestPath({ url: `/api/${resource}/secret-token?source=email` }),
      ).toBe(`/api/${resource}/:token`);
      expect(getRequestPath({ url: `/${resource}/secret-token` })).toBe(
        `/${resource}/:token`,
      );
      expect(
        getRequestPath({ url: `/api/${resource}/secret-token/extra/` }),
      ).toBe(`/api/${resource}/:token`);
    },
  );

  it.each([
    [
      '/api/auth/super-user-entries/ENTRY-KEY',
      '/api/auth/super-user-entries/:entryKey',
    ],
    [
      '/api/auth/super-user-entries/ENTRY-KEY?x=ENTRY-KEY',
      '/api/auth/super-user-entries/:entryKey',
    ],
    [
      '/api/auth/super-user-entries/ENTRY-KEY/sessions',
      '/api/auth/super-user-entries/:entryKey/sessions',
    ],
    [
      '/auth/super-user-entries/ENTRY-KEY/sessions',
      '/auth/super-user-entries/:entryKey/sessions',
    ],
    [
      '/api/auth/super-user-entries//ENTRY-KEY/other',
      '/api/auth/super-user-entries/:entryKey',
    ],
  ])('維護入口 %s 只留路由模板', (url, expected) => {
    expect(getRequestPath({ url })).toBe(expected);
  });

  it('一般 path 只移除 query', () => {
    expect(getRequestPath({ url: '/api/esign/documents/1?q=x' })).toBe(
      '/api/esign/documents/1',
    );
  });
});
