import { HttpStatus } from '@nestjs/common';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import {
  DEV_LOGIN_EMPID,
  DEV_LOGIN_NAME,
} from '#app/features/auth/auth.constants';
import { DevLoginService } from './dev-login.service';

/** 模擬 ConfigService：只回傳指定的環境變數。 */
const configOf = (env: Record<string, string>) => ({
  get: (key: string) => env[key],
});

const setup = (
  env: Record<string, string> = { DEVMOD: 'true' },
  existing: object | null = null,
) => {
  const db = {
    authRole: {
      findOne: jest.fn().mockResolvedValue({ id: 1, roleCode: 'ADMIN' }),
    },
    authUser: {
      findOne: jest.fn().mockResolvedValue(existing),
      create: jest.fn((value: object) => ({ ...value })),
      save: jest.fn(
        (value: object): Promise<object> =>
          Promise.resolve({ id: 99, ...value }),
      ),
      restore: jest.fn().mockResolvedValue(undefined),
    },
  };
  const sessions = { issue: jest.fn().mockResolvedValue('dev-jwt') };
  const authorization = {
    rememberUser: jest.fn().mockResolvedValue(undefined),
  };
  const authService = {
    buildSession: jest.fn().mockResolvedValue({ user: { id: 99 } }),
  };
  const logger = { warn: jest.fn() };
  const build = () =>
    new DevLoginService(
      configOf(env) as never,
      db as never,
      sessions as never,
      authorization as never,
      authService as never,
      logger as never,
    );
  return { build, db, sessions, authorization, authService, logger };
};

describe('DevLoginService', () => {
  it('production 卻設 DEVMOD=true → 建構即丟錯（開機失敗）', () => {
    const { build } = setup({ DEVMOD: 'true', NODE_ENV: 'production' });

    expect(build).toThrow(/DEVMOD=true 不可用於 production/);
  });

  it('未開 DEVMOD → 404，不碰 DB、不發 session', async () => {
    const { build, db, sessions } = setup({});

    await expect(build().login()).rejects.toMatchObject({
      code: AppErrorCode.NOT_FOUND,
      status: HttpStatus.NOT_FOUND,
    });
    expect(db.authUser.findOne).not.toHaveBeenCalled();
    expect(sessions.issue).not.toHaveBeenCalled();
  });

  it('首次使用：建立 dev-admin 帳號並綁 ADMIN，發 dev session、建授權快照', async () => {
    const { build, db, sessions, authorization, logger } = setup();

    const result = await build().login();

    expect(result).toEqual({
      accessToken: 'dev-jwt',
      session: { user: { id: 99 } },
    });
    expect(db.authUser.create).toHaveBeenCalledWith({
      personEmpid: DEV_LOGIN_EMPID,
      personName: DEV_LOGIN_NAME,
    });
    expect(db.authUser.save).toHaveBeenCalledWith(
      expect.objectContaining({ roleId: 1, isActive: true }),
    );
    expect(sessions.issue).toHaveBeenCalledWith(99, {
      source: 'dev',
      encryptedRefreshToken: null,
    });
    expect(authorization.rememberUser).toHaveBeenCalledWith(99);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'auth.dev_login' }),
    );
  });

  it('既有帳號被停用、軟刪或改了角色 → 還原為啟用中的 ADMIN', async () => {
    const { build, db } = setup(
      { DEVMOD: 'true' },
      {
        id: 99,
        personEmpid: DEV_LOGIN_EMPID,
        roleId: 5,
        isActive: false,
        deletedAt: new Date(),
      },
    );

    await build().login();

    expect(db.authUser.restore).toHaveBeenCalledWith({ id: 99 });
    expect(db.authUser.create).not.toHaveBeenCalled();
    expect(db.authUser.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 99, roleId: 1, isActive: true }),
    );
  });

  it('尚未執行 seed:rbac（無 ADMIN 角色）→ 明確錯誤，不建帳', async () => {
    const { build, db } = setup();
    db.authRole.findOne.mockResolvedValue(null);

    await expect(build().login()).rejects.toThrow(/seed:rbac/);
    expect(db.authUser.save).not.toHaveBeenCalled();
  });

  it('並發首次建帳撞唯一鍵 → 重讀後沿用既有帳號', async () => {
    const { build, db } = setup();
    db.authUser.save
      .mockRejectedValueOnce({ driverError: { code: 'ER_DUP_ENTRY' } })
      .mockResolvedValueOnce({ id: 99, personEmpid: DEV_LOGIN_EMPID });
    db.authUser.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 99, personEmpid: DEV_LOGIN_EMPID });

    await expect(build().login()).resolves.toMatchObject({
      accessToken: 'dev-jwt',
    });
    expect(db.authUser.save).toHaveBeenCalledTimes(2);
  });
});
