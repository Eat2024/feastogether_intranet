import { HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const user = {
    id: 7,
    empid: '00123',
    name: '王小明',
    departmentName: '資訊部',
    titleName: '工程師',
    lastLoginAt: new Date('2026-01-01T00:00:00Z'),
    isActive: true,
    deletedAt: null,
  };

  const setup = () => {
    const manager = {};
    const sessions = { read: jest.fn().mockResolvedValue({ source: 'oauth' }) };
    const users = { findById: jest.fn().mockResolvedValue(user) };
    const mysql = { getManager: jest.fn().mockReturnValue(manager) };
    return {
      service: new AuthService(
        sessions as never,
        users as never,
        mysql as never,
      ),
      sessions,
      users,
      manager,
    };
  };

  it('session response 只含必要 User profile', async () => {
    const { service, users, manager } = setup();
    const result = await service.getMe(7, 'token');
    expect(result).toEqual({
      user: {
        id: 7,
        empId: '00123',
        name: '王小明',
        departmentName: '資訊部',
        titleName: '工程師',
        lastLoginAt: user.lastLoginAt,
      },
    });
    expect(result).not.toHaveProperty('role');
    expect(result).not.toHaveProperty('permissions');
    expect(result).not.toHaveProperty('navigation');
    expect(users.findById).toHaveBeenCalledWith(7, manager);
  });

  it.each([
    [null],
    [{ ...user, isActive: false }],
    [{ ...user, deletedAt: new Date() }],
  ])('User 無效時回 401：%p', async (value) => {
    const { service, users } = setup();
    users.findById.mockResolvedValue(value);
    await expect(service.getMe(7, 'token')).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
  });

  it('session 不存在時回 401', async () => {
    const { service, sessions } = setup();
    sessions.read.mockResolvedValue(null);
    await expect(service.getMe(7, 'token')).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
  });
});
