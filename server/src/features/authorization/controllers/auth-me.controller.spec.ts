import type { AuthenticatedRequest } from '#app/framework/guards/auth.guard';
import { AuthMeController } from './auth-me.controller';

describe('AuthMeController', () => {
  it('合併 session 白名單與有效能力，不回傳角色', async () => {
    const modules = [
      { moduleKey: 'esign', permissions: ['esign.document.read'] },
    ];
    const resolver = {
      resolve: jest.fn().mockResolvedValue({
        actor: { kind: 'employee', userId: 7 },
        modules,
        roles: [{ id: 99 }],
      }),
    };
    const controller = new AuthMeController(resolver as never);
    const expiresAt = new Date('2026-11-07T08:00:00.000Z');
    const request = {
      authSession: {
        actor: { kind: 'employee', userId: 7 },
        user: {
          id: 7,
          empid: 'E00007',
          name: '測試員工',
          departmentName: '測試部門',
          titleName: '測試職稱',
          lastLoginAt: null,
        },
        expiresAt,
      },
    } as unknown as AuthenticatedRequest;

    await expect(controller.current(request)).resolves.toEqual({
      actor: { kind: 'employee', userId: 7 },
      user: {
        id: 7,
        empId: 'E00007',
        name: '測試員工',
        departmentName: '測試部門',
        titleName: '測試職稱',
        lastLoginAt: null,
      },
      expiresAt,
      modules,
    });
    expect(resolver.resolve).toHaveBeenCalledWith(request.authSession!.actor);
  });
});
