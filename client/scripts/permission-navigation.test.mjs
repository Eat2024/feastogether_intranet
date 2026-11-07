import assert from 'node:assert/strict';
import test from 'node:test';
import { filterVisibleMenu } from '../src/features/navigation/filter-visible-menu.ts';

const known = {
  esign: ['esign.document.read', 'esign.signing.read', 'esign.export.read'],
  travel: ['travel.account.read'],
};

const link = (key, moduleKey, requiredPermissions) => ({
  kind: 'link', key, moduleKey, requiredPermissions, label: key, href: `/${key}`,
});

test('只用相同 moduleKey 的完整 permission 顯示獨立項', () => {
  const menu = [
    link('documents', 'esign', ['esign.document.read']),
    link('exports', 'esign', ['esign.export.read']),
  ];
  const result = filterVisibleMenu(menu, [
    { moduleKey: 'travel', permissions: ['esign.export.read'] },
    { moduleKey: 'esign', permissions: ['esign.document.read'] },
  ], known);
  assert.deepEqual(result.map((item) => item.key), ['documents']);
});

test('多能力採 AND，未知與缺漏 mapping fail closed', () => {
  const menu = [
    link('both', 'esign', ['esign.document.read', 'esign.export.read']),
    link('unknown', 'esign', ['esign.unknown.read']),
    link('missing', 'esign', []),
  ];
  assert.deepEqual(filterVisibleMenu(menu, [
    { moduleKey: 'esign', permissions: ['esign.document.read'] },
  ], known), []);
});

test('群組過濾子項並隱藏空群組，且不修改輸入', () => {
  const children = [
    link('accounts', 'travel', ['travel.account.read']),
    link('roles', 'esign', ['esign.export.read']),
  ];
  const menu = [{ kind: 'group', key: 'admin', label: '管理', children }];
  const result = filterVisibleMenu(menu, [
    { moduleKey: 'travel', permissions: ['travel.account.read'] },
  ], known);
  assert.deepEqual(result[0].children.map((item) => item.key), ['accounts']);
  assert.equal(menu[0].children, children);
  assert.deepEqual(filterVisibleMenu(menu, [], known), []);
});

test('重複 key 不會默認顯示', () => {
  const menu = [
    link('same', 'esign', ['esign.document.read']),
    link('same', 'esign', ['esign.document.read']),
  ];
  assert.deepEqual(filterVisibleMenu(menu, [
    { moduleKey: 'esign', permissions: ['esign.document.read'] },
  ], known), []);
});
