import { safeLoginReturnPath } from './login-return-path';

describe('登入返回位置', () => {
  it.each([
    undefined,
    'https://evil.test',
    '//evil.test/forms',
    '/forms/../../api/auth/session',
    '/forms/%2e%2e/api',
    '/login',
    '/oauth/callback',
    '/external-signatures/abc',
    '/forms\\evil',
    '/forms\n',
  ])('拒絕不安全位置 %s', (path) => {
    expect(safeLoginReturnPath(path)).toBe('/forms');
  });

  it.each([
    '/forms/42/edit',
    '/my-signature/task-id',
    '/forms?page=2',
    '/forms?q=%E7%B0%BD%E7%BD%B2',
    '/export-history',
  ])('保留員工頁面 %s', (path) => {
    expect(safeLoginReturnPath(path)).toBe(path);
  });
});
