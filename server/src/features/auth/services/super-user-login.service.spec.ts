import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppException } from '#app/common/errors/app.exception';
import { AppErrors } from '#app/common/errors/app-errors';
import { SuperUserLoginService } from './super-user-login.service';

const ENTRY = 'E'.repeat(43);
const credentials = { account: ' e2e-super-user ', password: ' passé ' };

function setup() {
  const manager = {};
  const mysql = { getManager: () => manager, transaction: jest.fn() };
  const access = {
    find: jest.fn().mockResolvedValue({ entryKey: ENTRY }),
  };
  const superUserConfig = { verify: jest.fn().mockResolvedValue(true) };
  const events = { recordRejection: jest.fn().mockResolvedValue(undefined) };
  const issued = { token: 't'.repeat(43), expiresAt: new Date() };
  const sessions = { replace: jest.fn().mockResolvedValue(issued) };
  const logger = { warn: jest.fn() };
  const service = new SuperUserLoginService(
    mysql as never,
    access as never,
    superUserConfig as never,
    events as never,
    sessions as never,
    logger as never,
  );
  return {
    service,
    mysql,
    access,
    superUserConfig,
    events,
    sessions,
    logger,
    issued,
  };
}

describe('SuperUserLoginService', () => {
  describe('assertEntry 位置預檢', () => {
    it('目前入口通過；只讀 singleton，不開交易', async () => {
      const { service, mysql, access } = setup();

      await expect(service.assertEntry(ENTRY)).resolves.toBeUndefined();
      expect(access.find).toHaveBeenCalledTimes(1);
      expect(mysql.transaction).not.toHaveBeenCalled();
    });

    it.each([
      ['舊入口', 'O'.repeat(43)],
      ['長度不符', 'E'.repeat(42)],
      ['非 base64url 字元', `${'E'.repeat(42)}/`],
      ['多位元組字元', `${'E'.repeat(41)}é`],
      ['空字串', ''],
    ])('%s回 404，安全紀錄不含入口', async (_label, entryKey) => {
      const { service, logger } = setup();

      await expect(service.assertEntry(entryKey)).rejects.toMatchObject({
        code: AppErrorCode.NOT_FOUND,
        status: 404,
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'auth.super_user_entry_rejected' }),
      );
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
        entryKey || ENTRY,
      );
    });

    it('尚未初始化回 503，不隱式建立入口', async () => {
      const { service, access } = setup();
      access.find.mockResolvedValue(null);

      await expect(service.assertEntry(ENTRY)).rejects.toMatchObject({
        code: AppErrorCode.AUTH_SUPER_USER_UNAVAILABLE,
        status: 503,
      });
    });

    it('DB 查詢失敗回 503，不放行也不當成 404', async () => {
      const { service, access } = setup();
      access.find.mockRejectedValue(new Error('connection lost'));

      await expect(service.assertEntry(ENTRY)).rejects.toMatchObject({
        code: AppErrorCode.AUTH_DB_UNAVAILABLE,
        status: 503,
      });
    });
  });

  describe('login', () => {
    it('帳密原樣交給 KDF 驗證；成功後以目前 cookie 與入口原子替換會話', async () => {
      const { service, superUserConfig, sessions, issued, events } = setup();

      await expect(
        service.login(ENTRY, credentials, 'c'.repeat(43)),
      ).resolves.toBe(issued);
      expect(superUserConfig.verify).toHaveBeenCalledWith(
        ' e2e-super-user ',
        ' passé ',
      );
      expect(sessions.replace).toHaveBeenCalledWith('c'.repeat(43), {
        kind: 'super_user',
        entryKey: ENTRY,
      });
      expect(events.recordRejection).not.toHaveBeenCalled();
    });

    it('帳密錯誤統一 401：記匿名拒絕事件，不替換、不撤銷原會話', async () => {
      const { service, superUserConfig, sessions, events } = setup();
      superUserConfig.verify.mockResolvedValue(false);

      await expect(
        service.login(ENTRY, credentials, 'c'.repeat(43)),
      ).rejects.toMatchObject({
        code: AppErrorCode.AUTH_SUPER_USER_CREDENTIALS_INVALID,
        status: 401,
        message: '帳號或密碼錯誤',
      });
      expect(events.recordRejection).toHaveBeenCalledWith({
        type: 'login.rejected',
        actor: { kind: 'anonymous' },
        outcome: 'credentials_invalid',
      });
      expect(sessions.replace).not.toHaveBeenCalled();
    });

    it('拒絕事件無法保存時回 503，不假裝已記錄也不替換會話', async () => {
      const { service, superUserConfig, sessions, events } = setup();
      superUserConfig.verify.mockResolvedValue(false);
      events.recordRejection.mockRejectedValue(
        new AppException(...AppErrors.AUTH_DB_UNAVAILABLE),
      );

      await expect(
        service.login(ENTRY, credentials, null),
      ).rejects.toMatchObject({ code: AppErrorCode.AUTH_DB_UNAVAILABLE });
      expect(sessions.replace).not.toHaveBeenCalled();
    });
  });
});
