import { sanitizeAuthorizationSnapshot } from './authorization-audit.service';

describe('授權稽核白名單', () => {
  it('只保留設定與本地 ID，不保存個資、憑證或文件', () => {
    expect(
      sanitizeAuthorizationSnapshot({
        roleCode: 'reviewer',
        roleName: '覆核者',
        isActive: true,
        version: 2,
        permissionKeys: ['esign.document.read'],
        roleIds: [3],
        userId: 4,
        empId: 'SECRET',
        cookie: 'SECRET',
        signature: 'SECRET',
        document: { secret: true },
      }),
    ).toEqual({
      roleCode: 'reviewer',
      roleName: '覆核者',
      isActive: true,
      version: 2,
      permissionKeys: ['esign.document.read'],
      roleIds: [3],
      userId: 4,
    });
  });
  it('不能利用白名單欄位夾帶任意物件，集合輸出排序去重', () => {
    expect(
      sanitizeAuthorizationSnapshot({
        roleName: { secret: 'SECRET' },
        roleIds: [3, 3, 1],
        permissionKeys: [
          'esign.signing.read',
          'esign.document.read',
          'esign.document.read',
        ],
        userId: 'SECRET',
      }),
    ).toEqual({
      roleIds: [1, 3],
      permissionKeys: ['esign.document.read', 'esign.signing.read'],
    });
  });
});
