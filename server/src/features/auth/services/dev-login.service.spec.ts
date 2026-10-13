import { HttpStatus } from '@nestjs/common';
import { DEV_LOGIN_EMPID } from '#app/features/auth/auth.constants';
import { DevLoginService } from './dev-login.service';

describe('DevLoginService', () => {
  const setup = (env: Record<string, string> = { DEVMOD: 'true' }) => {
    const manager = {};
    const config = { get: jest.fn((key: string) => env[key]) };
    const users = {
      findByEmpid: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => ({ id: 99, ...value })),
      save: jest.fn((value) => Promise.resolve(value)),
      restore: jest.fn(),
    };
    const auth = {
      issueSession: jest.fn().mockResolvedValue({
        token: 'dev-token',
        expiresAt: new Date('2026-01-01T08:00:00Z'),
      }),
      buildSession: jest.fn((value) => ({ user: value })),
    };
    const logger = { warn: jest.fn() };
    const mysql = { getManager: jest.fn().mockReturnValue(manager) };
    return {
      service: new DevLoginService(
        config as never,
        users as never,
        auth as never,
        logger as never,
        mysql as never,
      ),
      users,
      auth,
      manager,
    };
  };

  it('建立一般 synthetic User，不查或配置 ADMIN role/permission', async () => {
    const { service, users, auth, manager } = setup();
    await expect(service.login()).resolves.toMatchObject({
      accessToken: 'dev-token',
    });
    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({ empid: DEV_LOGIN_EMPID }),
      manager,
    );
    expect(users.create.mock.calls[0][0]).not.toHaveProperty('roleId');
    expect(auth.issueSession).toHaveBeenCalledWith(99);
  });

  it.each(['production', 'staging'])('%s 環境 fail closed', (nodeEnv) => {
    expect(() => setup({ DEVMOD: 'true', NODE_ENV: nodeEnv })).toThrow();
  });

  it('DEVMOD 未開放時回 404', async () => {
    const { service } = setup({});
    await expect(service.login()).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
  });
});
