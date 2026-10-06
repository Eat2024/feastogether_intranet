import { DEFAULT_REDIRECT_TO, sanitizeRedirectTo } from './redirect-to';

describe('sanitizeRedirectTo', () => {
  it.each([
    ['/permissionManagement/accountManagement?page=2'],
    ['/permissionManagement/roleManagement'],
    ['/'],
  ])('站內相對路徑原樣保留：%s', (path) => {
    expect(sanitizeRedirectTo(path)).toBe(path);
  });

  it.each([
    ['站外絕對網址', 'https://evil.example.com/'],
    ['protocol-relative', '//evil.example.com'],
    ['反斜線繞過', '/\\evil.example.com'],
    ['不以 / 開頭', 'permissionManagement'],
    ['控制字元', '/foo\tbar'],
    ['登入頁循環', '/login?x=1'],
    ['回呼頁循環', '/oauth/callback?code=abc'],
    ['空字串', ''],
    ['非字串', 42],
    ['過長', `/${'a'.repeat(3000)}`],
  ])('%s → 退回預設首頁', (_label, input) => {
    expect(sanitizeRedirectTo(input)).toBe(DEFAULT_REDIRECT_TO);
  });
});
