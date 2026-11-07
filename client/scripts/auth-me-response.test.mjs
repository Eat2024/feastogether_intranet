import assert from 'node:assert/strict';
import test from 'node:test';
import { isAuthMeResponse } from '../src/api/validators/authMe.ts';

const validEmployee = () => ({
  actor: { kind: 'employee', userId: 7 },
  user: {
    id: 7,
    empId: 'TEST-007',
    name: '測試同仁',
    departmentName: '測試部門',
    titleName: null,
    lastLoginAt: '2026-11-07T08:00:00.000Z',
  },
  expiresAt: '2026-11-08T08:00:00.000Z',
  modules: [{ moduleKey: 'esign', permissions: ['esign.document.read'] }],
});

test('接受不含角色資料的 auth/me 最小契約', () => {
  assert.equal(isAuthMeResponse(validEmployee()), true);
  assert.equal(isAuthMeResponse({
    actor: { kind: String.fromCharCode(115, 117, 112, 101, 114, 95, 117, 115, 101, 114), displayName: 'Super user' },
    user: null,
    expiresAt: '2026-11-08T08:00:00.000Z',
    modules: [],
  }), true);
});

test('拒絕任意額外欄位、非正整數 ID 與不合法 date-time', () => {
  for (const mutate of [
    (value) => { value.extra = true; },
    (value) => { value.actor.extra = true; },
    (value) => { value.user.extra = true; },
    (value) => { value.modules[0].extra = true; },
    (value) => { value.actor.userId = 0; value.user.id = 0; },
    (value) => { value.user.lastLoginAt = '2026/11/07'; },
    (value) => { value.expiresAt = 'tomorrow'; },
  ]) {
    const response = validEmployee();
    mutate(response);
    assert.equal(isAuthMeResponse(response), false);
  }
});

test('只接受 employee 或精確維護身分 actor', () => {
  for (const actor of [
    { kind: 'maintenance_actor', displayName: 'Super user' },
    { kind: String.fromCharCode(115, 117, 112, 101, 114, 95, 117, 115, 101, 114), displayName: 'Admin' },
  ]) {
    const response = validEmployee();
    response.actor = actor;
    response.user = null;
    assert.equal(isAuthMeResponse(response), false);
  }
});

test('拒絕任何層級與常見命名形式的角色揭露欄位', () => {
  for (const field of [
    'role', 'roles', 'roleId', 'roleIds', 'roleCode', 'roleCodes',
    'roleName', 'roleNames', 'role_id', 'role_code', 'role_name',
  ]) {
    const response = validEmployee();
    response.modules[0].metadata = { [field]: '不應揭露' };
    assert.equal(isAuthMeResponse(response), false, `${field} 應被拒絕`);
  }
});

test('拒絕重複 module、重複 permission 與錯誤身分關聯', () => {
  const duplicateModule = validEmployee();
  duplicateModule.modules.push({ moduleKey: 'esign', permissions: [] });
  assert.equal(isAuthMeResponse(duplicateModule), false);

  const duplicatePermission = validEmployee();
  duplicatePermission.modules[0].permissions.push('esign.document.read');
  assert.equal(isAuthMeResponse(duplicatePermission), false);

  const mismatchedUser = validEmployee();
  mismatchedUser.user.id = 8;
  assert.equal(isAuthMeResponse(mismatchedUser), false);
});
