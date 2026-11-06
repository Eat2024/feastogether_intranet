import { effectivePermissionModules } from './authorization-resolver.service';

const employee = { kind: 'employee' as const, userId: 7 };
const baseline = [
  'esign.document.read',
  'esign.signing.copy',
  'esign.signing.read',
  'esign.signing.submit',
];
describe('有效能力的目錄交集', () => {
  it('無額外 grant 的有效員工僅有四個固定同仁能力', () => {
    expect(effectivePermissionModules(employee, [])).toEqual([
      { moduleKey: 'esign', permissions: baseline },
    ]);
  });
  it('同功能互補與重複 grant 聯集，不依角色名稱或未知／錯 scope 的碼升權', () => {
    expect(
      effectivePermissionModules(employee, [
        { moduleKey: 'esign', permissionKey: 'esign.document.create' },
        { moduleKey: 'esign', permissionKey: 'esign.document.create' },
        { moduleKey: 'esign', permissionKey: 'esign.export.read' },
        { moduleKey: 'test-module', permissionKey: 'esign.document.manage' },
        { moduleKey: 'esign', permissionKey: 'esign.unknown' },
        {
          moduleKey: 'platform',
          permissionKey: 'platform.authorization.manage',
        },
      ]),
    ).toEqual([
      {
        moduleKey: 'esign',
        permissions: [
          'esign.document.create',
          'esign.document.read',
          'esign.export.read',
          'esign.signing.copy',
          'esign.signing.read',
          'esign.signing.submit',
        ],
      },
    ]);
  });
  it('Super 列出全部十二項能力但不捏造員工角色', () => {
    const modules = effectivePermissionModules({ kind: 'super_user' }, []);
    expect(modules.map((m) => m.moduleKey)).toEqual(['esign', 'platform']);
    expect(modules[0].permissions).toHaveLength(11);
    expect(modules[1].permissions).toEqual(['platform.authorization.manage']);
  });
});
