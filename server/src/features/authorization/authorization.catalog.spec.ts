import {
  AUTHORIZATION_PERMISSIONS,
  INITIAL_ROLES,
  validateRolePermissions,
} from './authorization.catalog';

describe('授權程式目錄', () => {
  it('同仁固定四項、維護能力不可指派、沒有虛構業務子功能', () => {
    expect(AUTHORIZATION_PERMISSIONS).toHaveLength(12);
    expect([
      ...new Set(AUTHORIZATION_PERMISSIONS.map((p) => p.moduleKey)),
    ]).toEqual(['esign', 'platform']);
    expect(INITIAL_ROLES[0].permissionKeys).toEqual([
      'esign.document.read',
      'esign.signing.read',
      'esign.signing.submit',
      'esign.signing.copy',
    ]);
    expect(
      AUTHORIZATION_PERMISSIONS.find(
        (p) => p.permissionKey === 'platform.authorization.manage',
      )?.assignable,
    ).toBe(false);
  });
  it('範圍修飾碼必須在同角色含基本能力，跨 module 與平台能力不能指派', () => {
    expect(() =>
      validateRolePermissions('esign', ['esign.document.read-all']),
    ).toThrow();
    expect(() =>
      validateRolePermissions('esign', ['platform.authorization.manage']),
    ).toThrow();
    expect(() =>
      validateRolePermissions('platform', ['platform.authorization.manage']),
    ).toThrow();
    expect(() =>
      validateRolePermissions('esign', [
        'esign.export.all',
        'esign.export.read',
      ]),
    ).not.toThrow();
  });
});
