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

  it('一般 path 只移除 query', () => {
    expect(getRequestPath({ url: '/api/esign/documents/1?q=x' })).toBe(
      '/api/esign/documents/1',
    );
  });
});
