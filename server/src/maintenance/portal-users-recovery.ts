import type { DataSource, EntityManager } from 'typeorm';
import { User } from '#app/features/users/entities/user.entity';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { PortalImportError, digest } from './portal-users-source';
import {
  type PortalResult,
  type PortalPreview,
  type UserSnapshot,
  readSnapshots,
  targetIdentity,
} from './portal-users-import';
import { privatePath, readJson, writePrivate } from './portal-users-store';

export interface PortalRollbackPreview {
  version: 1;
  kind: 'portal-users-rollback-preview';
  batchId: string;
  target: string;
  resultPath: string;
  resultHash: string;
  previewedAt: string;
  summary: { restore: number; remove: number };
  digest: string;
}
const equal = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function snapshot(value: unknown): value is UserSnapshot {
  if (
    !object(value) ||
    !Number.isSafeInteger(value.id) ||
    Number(value.id) < 1 ||
    typeof value.isActive !== 'boolean'
  )
    return false;
  const required = ['empid', 'name', 'createdAt', 'updatedAt'];
  const optional = [
    'departmentCode',
    'departmentName',
    'email',
    'personStatus',
    'titleName',
    'lastLoginAt',
    'deletedAt',
  ];
  return (
    required.every((key) => typeof value[key] === 'string') &&
    optional.every(
      (key) => value[key] === null || typeof value[key] === 'string',
    ) &&
    (value.departmentId === null || Number.isSafeInteger(value.departmentId))
  );
}
/** 只有完整 applied 結果可回復；intent 與 prepared 共同綁定原值及本次實際寫入值。 */
export async function loadAppliedResult(path: string): Promise<PortalResult> {
  const value = await readJson(path);
  if (
    !object(value) ||
    value.version !== 1 ||
    value.kind !== 'portal-users-result' ||
    value.status !== 'applied' ||
    typeof value.completedAt !== 'string' ||
    typeof value.batchId !== 'string' ||
    typeof value.target !== 'string' ||
    typeof value.previewHash !== 'string' ||
    !Array.isArray(value.changes)
  )
    throw new PortalImportError('只有完整提交且完成紀錄的批次可以自動回復');
  const intent = await readJson(`${path}.intent`);
  const prepared = await readJson(`${path}.prepared`);
  if (
    !object(intent) ||
    !object(intent.preview) ||
    !object(prepared) ||
    prepared.status !== 'prepared'
  )
    throw new PortalImportError('缺少完整回復依據，請人工對帳');
  const { digest: expected, ...previewBody } = intent.preview;
  if (
    expected !== value.previewHash ||
    digest(JSON.stringify(previewBody)) !== expected ||
    intent.preview.batchId !== value.batchId ||
    intent.preview.target !== value.target ||
    !Array.isArray(intent.preview.operations)
  )
    throw new PortalImportError('批次原值完整性檢查失敗');
  if (!equal({ ...value, status: 'prepared', completedAt: null }, prepared))
    throw new PortalImportError('提交結果與寫入紀錄不一致');
  const preview = intent.preview as unknown as PortalPreview;
  const changes = value.changes as unknown[];
  const operations = preview.operations.filter(
    (operation) => operation.kind === 'create' || operation.kind === 'update',
  );
  if (operations.length !== changes.length)
    throw new PortalImportError('回復集合不完整');
  const seen = new Set<number>();
  for (const change of changes) {
    if (
      !object(change) ||
      !snapshot(change.after) ||
      (change.before !== null && !snapshot(change.before))
    )
      throw new PortalImportError('回復快照格式不合法');
    const after = change.after,
      before = change.before;
    const operation = operations.find(
      (item) => item.desired.empid === after.empid,
    );
    if (
      !operation ||
      seen.has(after.id) ||
      !equal(operation.before, before) ||
      (before !== null &&
        (before.id !== after.id || before.empid !== after.empid))
    )
      throw new PortalImportError('回復集合與預覽不一致');
    for (const [key, expectedValue] of Object.entries(operation.desired)) {
      if (after[key as keyof UserSnapshot] !== expectedValue)
        throw new PortalImportError('寫入結果與預期欄位不一致');
    }
    seen.add(after.id);
  }
  return value as unknown as PortalResult;
}
interface Reference {
  schema: string;
  table: string;
  column: string;
  target: 'id' | 'empid';
  foreignKey: boolean;
}
function identifier(value: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(value))
    throw new PortalImportError('無法安全檢查使用者相依，拒絕自動回復');
  return '`' + value + '`';
}
/** 列出所有 FK（含跨 schema）及本 schema 明確使用者欄位，未知引用鍵拒絕猜測。 */
async function userReferences(manager: EntityManager): Promise<Reference[]> {
  const foreign = await manager.query<
    Array<{ schema: string; table: string; column: string; target: string }>
  >(
    `SELECT TABLE_SCHEMA AS \`schema\`, TABLE_NAME AS \`table\`, COLUMN_NAME AS \`column\`, REFERENCED_COLUMN_NAME AS target FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME='users'`,
  );
  if (foreign.some((ref) => ref.target !== 'id' && ref.target !== 'empid'))
    throw new PortalImportError('存在無法判定的使用者引用，拒絕自動回復');
  const columns = await manager.query<
    Array<{ schema: string; table: string; column: string }>
  >(
    'SELECT TABLE_SCHEMA AS `schema`,TABLE_NAME AS `table`,COLUMN_NAME AS `column` FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()',
  );
  const references = new Map<string, Reference>();
  for (const reference of foreign)
    references.set(
      JSON.stringify([reference.schema, reference.table, reference.column]),
      {
        ...reference,
        target: reference.target as 'id' | 'empid',
        foreignKey: true,
      },
    );
  for (const column of columns) {
    if (
      column.table === 'users' ||
      !column.column.toLowerCase().replaceAll('_', '').endsWith('userid')
    )
      continue;
    const key = JSON.stringify([column.schema, column.table, column.column]);
    if (!references.has(key))
      references.set(key, { ...column, target: 'id', foreignKey: false });
  }
  // 既有 session 與稽核皆為必要檢查，metadata 權限不足不能把空集合當安全。
  for (const [table, column] of [
    ['auth_sessions', 'user_id'],
    ['esign_audit_events', 'actor_user_id'],
  ]) {
    if (
      ![...references.values()].some(
        (reference) => reference.table === table && reference.column === column,
      )
    )
      throw new PortalImportError('無法確認登入或稽核相依，拒絕自動回復');
  }
  return [...references.values()].sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b)),
  );
}
async function assertUnreferenced(
  manager: EntityManager,
  created: UserSnapshot[],
): Promise<void> {
  if (!created.length) return;
  if (created.some((user) => user.lastLoginAt !== null))
    throw new PortalImportError('新帳號已有登入紀錄，拒絕自動回復');
  const references = await userReferences(manager);
  // 空表的 gap lock 不能讓非 FK writer 在刪除提交後重新驗證使用者存在。
  if (references.some((reference) => !reference.foreignKey))
    throw new PortalImportError(
      '存在非外鍵使用者引用欄位，無法確認安全，拒絕新增帳號自動刪除',
    );
  for (const reference of references) {
    for (let offset = 0; offset < created.length; offset += 500) {
      const values = created
        .slice(offset, offset + 500)
        .map((user) => (reference.target === 'id' ? user.id : user.empid));
      const used = await manager.query<unknown[]>(
        `SELECT 1 FROM ${identifier(reference.schema)}.${identifier(reference.table)} WHERE ${identifier(reference.column)} IN (${values.map(() => '?').join(',')}) LIMIT 1 FOR UPDATE`,
        values,
      );
      if (used.length)
        throw new PortalImportError('新帳號已有引用，拒絕整批自動回復');
    }
  }
}
async function checkCurrent(
  manager: EntityManager,
  result: PortalResult,
): Promise<void> {
  const expected = result.changes
    .map((change) => change.after)
    .sort((a, b) => a.id - b.id);
  const current = await readSnapshots(
    manager,
    expected.map((row) => row.id),
    'id',
    true,
  );
  if (!equal(current, expected))
    throw new PortalImportError('匯入後資料已變更，拒絕整批回復');
  await assertUnreferenced(
    manager,
    result.changes
      .filter((change) => change.before === null)
      .map((change) => change.after),
  );
}
export async function previewPortalRollback(
  ds: DataSource,
  resultPath: string,
  output: string,
): Promise<PortalRollbackPreview> {
  const canonical = await privatePath(resultPath);
  const result = await loadAppliedResult(canonical);
  if (result.target !== (await targetIdentity(ds.manager)))
    throw new PortalImportError('回復批次與目標資料庫不一致');
  await ds.transaction('REPEATABLE READ', (manager) =>
    checkCurrent(manager, result),
  );
  const body: Omit<PortalRollbackPreview, 'digest'> = {
    version: 1,
    kind: 'portal-users-rollback-preview',
    batchId: result.batchId,
    target: result.target,
    resultPath: canonical,
    resultHash: digest(JSON.stringify(result)),
    previewedAt: new Date().toISOString(),
    summary: {
      restore: result.changes.filter((change) => change.before !== null).length,
      remove: result.changes.filter((change) => change.before === null).length,
    },
  };
  const preview = { ...body, digest: digest(JSON.stringify(body)) };
  await writePrivate(output, preview);
  return preview;
}
async function loadRollbackPreview(
  path: string,
): Promise<PortalRollbackPreview> {
  const value = await readJson(path);
  if (
    !object(value) ||
    value.version !== 1 ||
    value.kind !== 'portal-users-rollback-preview' ||
    typeof value.resultPath !== 'string' ||
    typeof value.digest !== 'string'
  )
    throw new PortalImportError('回復預覽格式不合法');
  const { digest: expected, ...body } = value;
  if (digest(JSON.stringify(body)) !== expected)
    throw new PortalImportError('回復預覽完整性檢查失敗');
  return value as unknown as PortalRollbackPreview;
}
export async function rollbackPortalUsers(
  ds: DataSource,
  previewPath: string,
): Promise<{ batchId: string; summary: { restore: number; remove: number } }> {
  const preview = await loadRollbackPreview(previewPath);
  const result = await loadAppliedResult(preview.resultPath);
  if (
    digest(JSON.stringify(result)) !== preview.resultHash ||
    result.batchId !== preview.batchId ||
    preview.target !== result.target ||
    preview.target !== (await targetIdentity(ds.manager))
  )
    throw new PortalImportError('回復預覽或目標資料庫不一致');
  await writePrivate(`${previewPath}.rollback-lock`, {
    batchId: preview.batchId,
    startedAt: new Date().toISOString(),
  });
  const repository = new UserRepository();
  await ds.transaction('REPEATABLE READ', async (manager) => {
    await checkCurrent(manager, result);
    await writePrivate(`${previewPath}.rollback-prepared`, {
      batchId: preview.batchId,
      changes: result.changes,
    });
    for (const change of result.changes) {
      if (!change.before) continue;
      const before = change.before;
      const entity = manager.create(User, {
        id: before.id,
        name: before.name,
        email: before.email,
        departmentCode: before.departmentCode,
        departmentName: before.departmentName,
      });
      Object.assign(entity, {
        personStatus: before.personStatus,
        titleName: before.titleName,
      });
      await repository.save(entity, manager);
      // 回復原始微秒時間；不更新其他非本批管理欄位。
      await manager.query('UPDATE users SET updated_at=? WHERE id=?', [
        before.updatedAt,
        before.id,
      ]);
    }
    const ids = result.changes
      .filter((change) => change.before === null)
      .map((change) => change.after.id);
    for (let offset = 0; offset < ids.length; offset += 500)
      await manager.delete(User, ids.slice(offset, offset + 500));
  });
  const completed = { batchId: preview.batchId, summary: preview.summary };
  try {
    await writePrivate(`${previewPath}.rollback-result`, {
      ...completed,
      status: 'rolled-back',
      completedAt: new Date().toISOString(),
    });
  } catch {
    throw new PortalImportError(
      '資料庫已回復，但結果檔寫入失敗；請人工對帳，勿重跑',
    );
  }
  return completed;
}
