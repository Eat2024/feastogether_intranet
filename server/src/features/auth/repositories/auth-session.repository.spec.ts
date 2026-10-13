import {
  AUTH_SESSION_STATUS,
  AuthSession,
} from '../entities/auth-session.entity';
import { AuthSessionRepository } from './auth-session.repository';

describe('AuthSessionRepository', () => {
  const repository = new AuthSessionRepository();

  it('createValidating 只保存 jti 摘要與 assertion expiry', async () => {
    const record = { id: 1 };
    const manager = {
      create: jest.fn().mockReturnValue(record),
      save: jest.fn().mockResolvedValue(record),
    };
    const expiresAt = new Date();
    await expect(
      repository.createValidating('a'.repeat(64), expiresAt, manager as never),
    ).resolves.toBe(record);
    expect(manager.create).toHaveBeenCalledWith(AuthSession, {
      source: 'webview',
      status: AUTH_SESSION_STATUS.VALIDATING,
      sourceJtiHash: 'a'.repeat(64),
      assertionExpiresAt: expiresAt,
    });
  });

  it('markPending 使用 validating 條件更新，競態失敗時拒絕', async () => {
    const manager = { update: jest.fn().mockResolvedValue({ affected: 0 }) };
    await expect(
      repository.markPending(
        1,
        7,
        'b'.repeat(64),
        new Date(),
        new Date(),
        manager as never,
      ),
    ).rejects.toThrow('AUTH_SESSION_TRANSITION_FAILED');
    expect(manager.update).toHaveBeenCalledWith(
      AuthSession,
      { id: 1, status: AUTH_SESSION_STATUS.VALIDATING },
      expect.objectContaining({ status: AUTH_SESSION_STATUS.PENDING }),
    );
  });

  it('revoke 只在成功撤銷一筆有效 session 時回傳 true', async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce({ affected: 1 })
      .mockResolvedValueOnce({ affected: 0 });
    const builder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute,
    };
    const manager = { createQueryBuilder: jest.fn().mockReturnValue(builder) };

    await expect(
      repository.revoke('c'.repeat(64), new Date(), manager as never),
    ).resolves.toBe(true);
    await expect(
      repository.revoke('c'.repeat(64), new Date(), manager as never),
    ).resolves.toBe(false);
  });
});
