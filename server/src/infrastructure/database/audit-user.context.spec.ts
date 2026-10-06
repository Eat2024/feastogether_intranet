import { ClsService } from 'nestjs-cls';
import { AppException } from '#app/common/errors/app.exception';
import { clsUserId, requireClsUserId } from './audit-user.context';

describe('audit-user.context', () => {
  const inactive = { isActive: () => false } as unknown as ClsService;
  const loggedIn = {
    isActive: () => true,
    get: () => '9001',
  } as unknown as ClsService;

  describe('clsUserId', () => {
    it('CLS 未啟動（worker／排程）→ undefined，不丟錯', () => {
      expect(clsUserId(inactive)).toBeUndefined();
    });

    it('CLS 有登入者 → 回 userId', () => {
      expect(clsUserId(loggedIn)).toBe('9001');
    });
  });

  describe('requireClsUserId（操作人綁登入身分）', () => {
    it('無 CLS 身分（匿名）→ throw 401（責任稽核不可斷鏈）', () => {
      expect(() => requireClsUserId(inactive)).toThrow(AppException);
    });

    it('CLS 有登入者 → 回 userId', () => {
      expect(requireClsUserId(loggedIn)).toBe('9001');
    });
  });
});
