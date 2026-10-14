import { getRequestPath } from './request.context';

describe('getRequestPath', () => {
  it('外部邀請 path 一律遮蔽 bearer token', () => {
    expect(
      getRequestPath({
        url: '/api/external-signature-invitations/secret-token?source=email',
      }),
    ).toBe('/api/external-signature-invitations/:token');
  });

  it('一般 path 只移除 query', () => {
    expect(getRequestPath({ url: '/api/esign/documents/1?q=x' })).toBe(
      '/api/esign/documents/1',
    );
  });
});
