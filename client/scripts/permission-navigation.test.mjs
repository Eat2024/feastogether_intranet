import assert from 'node:assert/strict';
import test from 'node:test';
import { getBreadcrumbItems, ROUTES } from '../src/constants/routes.ts';
import { filterVisibleMenu } from '../src/features/navigation/filter-visible-menu.ts';
import { hasPermission } from '../src/features/navigation/has-permission.ts';

const known = {
  esign: ['esign.document.read', 'esign.signing.read', 'esign.export.read'],
  travel: ['travel.account.read'],
};

const link = (key, moduleKey, requiredPermissions) => ({
  kind: 'link', key, moduleKey, requiredPermissions, label: key, href: `/${key}`,
});

const permissionsOf = (modules) => (moduleKey, ...permissions) =>
  hasPermission(modules, moduleKey, ...permissions);

test('只用相同 moduleKey 的完整 permission 顯示獨立項', () => {
  const menu = [
    link('documents', 'esign', ['esign.document.read']),
    link('exports', 'esign', ['esign.export.read']),
  ];
  const result = filterVisibleMenu(menu, permissionsOf([
    { moduleKey: 'travel', permissions: ['esign.export.read'] },
    { moduleKey: 'esign', permissions: ['esign.document.read'] },
  ]), known);
  assert.deepEqual(result.map((item) => item.key), ['documents']);
});

test('多能力採 AND，未知與缺漏 mapping fail closed', () => {
  const menu = [
    link('both', 'esign', ['esign.document.read', 'esign.export.read']),
    link('unknown', 'esign', ['esign.unknown.read']),
    link('missing', 'esign', []),
  ];
  assert.deepEqual(filterVisibleMenu(menu, permissionsOf([
    { moduleKey: 'esign', permissions: ['esign.document.read'] },
  ]), known), []);
});

test('群組過濾子項並隱藏空群組，且不修改輸入', () => {
  const children = [
    link('accounts', 'travel', ['travel.account.read']),
    link('roles', 'esign', ['esign.export.read']),
  ];
  const menu = [{ kind: 'group', key: 'admin', label: '管理', children }];
  const result = filterVisibleMenu(menu, permissionsOf([
    { moduleKey: 'travel', permissions: ['travel.account.read'] },
  ]), known);
  assert.deepEqual(result[0].children.map((item) => item.key), ['accounts']);
  assert.equal(menu[0].children, children);
  assert.deepEqual(filterVisibleMenu(menu, permissionsOf([]), known), []);
});

test('重複 key 不會默認顯示', () => {
  const menu = [
    link('same', 'esign', ['esign.document.read']),
    link('same', 'esign', ['esign.document.read']),
  ];
  assert.deepEqual(filterVisibleMenu(menu, permissionsOf([
    { moduleKey: 'esign', permissions: ['esign.document.read'] },
  ]), known), []);
});

test('hasPermission 只在相同 module 精確採 AND，空需求 fail closed', () => {
  const modules = [
    { moduleKey: 'esign', permissions: ['esign.document.read', 'esign.export.read'] },
    { moduleKey: 'travel', permissions: ['esign.document.read'] },
  ];
  assert.equal(hasPermission(modules, 'esign', 'esign.document.read'), true);
  assert.equal(hasPermission(modules, 'esign', 'esign.document.read', 'esign.export.read'), true);
  assert.equal(hasPermission(modules, 'travel', 'esign.export.read'), false);
  assert.equal(hasPermission(modules, 'esign'), false);
});

test('route catalog 同時提供選單與 Breadcrumb 的名稱及路徑', () => {
  assert.deepEqual(getBreadcrumbItems(ROUTES.esignForms.href), [
    ROUTES.home,
    ROUTES.esign,
    ROUTES.esignForms,
  ]);
});
