import { safeLoginReturnPath } from './login-return-path';

describe('登入返回位置', () => {
  it.each([
    undefined,
    'https://evil.test',
    '//evil.test/forms',
    '/esign/forms/../../api/auth/session',
    '/esign/forms/%2e%2e/api',
    '/login',
    '/oauth/callback',
    '/external-signatures/abc',
    '/forms/42',
    '/esign/forms\\evil',
    '/esign/forms\n',
  ])('拒絕不安全位置 %s', (path) => {
    expect(safeLoginReturnPath(path)).toBe('/esign/forms');
  });

  it.each([
    '/esign/forms/42/edit',
    '/esign/my-signature/task-id',
    '/esign/forms?page=2',
    '/esign/forms?q=%E7%B0%BD%E7%BD%B2',
    '/esign/export-history',
  ])('保留員工頁面 %s', (path) => {
    expect(safeLoginReturnPath(path)).toBe(path);
  });
});
