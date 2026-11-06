import type { User } from '#app/features/users/entities/user.entity';
import { toSessionView } from './session-view.dto';

const expiresAt = new Date('2026-11-05T12:00:00Z');

describe('toSessionView', () => {
  it('員工沿用既有 user 白名單，另加 actor；不帶 email 等其他欄位', () => {
    const user = {
      id: 7,
      empid: '00123',
      name: '王小明',
      email: 'someone@example.test',
      isActive: true,
      departmentName: '資訊部',
      titleName: '工程師',
      lastLoginAt: new Date('2026-01-01T00:00:00Z'),
    } as unknown as User;

    expect(
      toSessionView({
        actor: { kind: 'employee', userId: 7 },
        user,
        expiresAt,
      }),
    ).toEqual({
      actor: { kind: 'employee', userId: 7 },
      user: {
        id: 7,
        empId: '00123',
        name: '王小明',
        departmentName: '資訊部',
        titleName: '工程師',
        lastLoginAt: user.lastLoginAt,
      },
      expiresAt,
    });
  });

  it('Super user 只有固定顯示名稱，user 為 null', () => {
    expect(
      toSessionView({ actor: { kind: 'super_user' }, user: null, expiresAt }),
    ).toEqual({
      actor: { kind: 'super_user', displayName: 'Super user' },
      user: null,
      expiresAt,
    });
  });
});
