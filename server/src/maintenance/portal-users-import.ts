import { PortalImportError } from './portal-users-source';
import { randomUUID } from 'node:crypto';
import { rename } from 'node:fs/promises';
import { User } from '#app/features/users/entities/user.entity';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import type { DataSource, EntityManager } from 'typeorm';
import {
  digest,
  parsePortalUsers,
  validateAcquiredAt,
  type PortalExclusion,
  type PortalSource,
  type PortalUserFields,
} from './portal-users-source';
import {
  privatePath,
  readJson,
  readSource,
  writePrivate,
} from './portal-users-store';

export interface UserSnapshot extends PortalUserFields {
  id: number;
  isActive: boolean;
  departmentId: number | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
export interface ImportOperation {
  kind: 'create' | 'update' | 'noop' | 'protected';
  before: UserSnapshot | null;
  desired: PortalUserFields;
}
export interface ImportSummary {
  sourceRows: number;
  uniqueEmployees: number;
  duplicates: number;
  excluded: number;
  ineligible: number;
  create: number;
  update: number;
  noop: number;
  protected: number;
  missingEmail: number;
  clearedEmail: number;
}
export interface PortalPreview {
  version: 1;
  kind: 'portal-users-preview';
  batchId: string;
  target: string;
  sourcePath: string;
  sourceHash: string;
  acquiredAt: string;
  previewedAt: string;
  exclusions: PortalExclusion[];
  summary: ImportSummary;
  operations: ImportOperation[];
  digest: string;
}
export interface PortalResult {
  version: 1;
  kind: 'portal-users-result';
  batchId: string;
  target: string;
  previewHash: string;
  status: 'prepared' | 'applied';
  completedAt: string | null;
  summary: ImportSummary;
  changes: Array<{ before: UserSnapshot | null; after: UserSnapshot }>;
}
const users = new UserRepository();
const SNAPSHOT_SELECT = `SELECT id,empid,name,department_code departmentCode,department_name departmentName,email,person_status personStatus,title_name titleName,is_active isActive,department_id departmentId,
DATE_FORMAT(last_login_at,'%Y-%m-%d %H:%i:%s.%f') lastLoginAt,
DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s.%f') createdAt,
DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s.%f') updatedAt,
DATE_FORMAT(deleted_at,'%Y-%m-%d %H:%i:%s.%f') deletedAt FROM users`;
function normalizeSnapshot(row: UserSnapshot): UserSnapshot {
  return {
    ...row,
    id: Number(row.id),
    isActive: !!row.isActive,
    departmentId: row.departmentId === null ? null : Number(row.departmentId),
  };
}
export async function targetIdentity(manager: EntityManager): Promise<string> {
  const rows = await manager.query<Array<{ database: string; server: string }>>(
    'SELECT DATABASE() AS `database`, @@server_uuid AS server',
  );
  if (!rows[0]?.database || !rows[0].server)
    throw new PortalImportError('無法確認目標資料庫身分');
  return digest(JSON.stringify(rows[0]));
}
export async function readSnapshots(
  manager: EntityManager,
  values: readonly (string | number)[],
  column: 'id' | 'empid',
  lock = false,
): Promise<UserSnapshot[]> {
  const result = new Map<number, UserSnapshot>();
  for (let offset = 0; offset < values.length; offset += 500) {
    const batch = values.slice(offset, offset + 500);
    const rows = await manager.query<UserSnapshot[]>(
      `${SNAPSHOT_SELECT} WHERE ${column} IN (${batch.map(() => '?').join(',')}) ORDER BY id ASC${lock ? ' FOR UPDATE' : ''}`,
      batch,
    );
    for (const raw of rows) {
      const row = normalizeSnapshot(raw);
      result.set(row.id, row);
    }
  }
  return [...result.values()].sort((a, b) => a.id - b.id);
}
function desiredValues(row: PortalUserFields): PortalUserFields {
  return {
    empid: row.empid,
    name: row.name,
    departmentCode: row.departmentCode,
    departmentName: row.departmentName,
    email: row.email,
    personStatus: row.personStatus,
    titleName: row.titleName,
  };
}
function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
export function planOperations(
  source: PortalSource,
  current: UserSnapshot[],
): ImportOperation[] {
  const indexed = new Map(current.map((row) => [row.empid, row]));
  const selected = new Set(source.rows.map((row) => row.empid));
  if (current.some((row) => !selected.has(row.empid)))
    throw new PortalImportError('目標員編 collation 衝突，請先人工核對');
  return source.rows.map((desired) => {
    const before = indexed.get(desired.empid) ?? null;
    const kind = !before
      ? 'create'
      : !before.isActive || before.deletedAt
        ? 'protected'
        : equal(desiredValues(before), desired)
          ? 'noop'
          : 'update';
    return { kind, before, desired };
  });
}
function summarize(
  source: PortalSource,
  operations: ImportOperation[],
): ImportSummary {
  return {
    sourceRows: source.sourceRows,
    uniqueEmployees: source.rows.length,
    duplicates: source.duplicateRows,
    excluded: source.excludedRows,
    ineligible: source.ineligibleRows,
    create: operations.filter((o) => o.kind === 'create').length,
    update: operations.filter((o) => o.kind === 'update').length,
    noop: operations.filter((o) => o.kind === 'noop').length,
    protected: operations.filter((o) => o.kind === 'protected').length,
    missingEmail: source.rows.filter((r) => r.email === null).length,
    clearedEmail: operations.filter(
      (o) => o.kind === 'update' && o.before?.email && o.desired.email === null,
    ).length,
  };
}
export async function previewPortalUsers(
  ds: DataSource,
  input: string,
  output: string,
  acquiredAt: string,
  exclusions: PortalExclusion[] = [],
): Promise<PortalPreview> {
  const sourceAcquiredAt = validateAcquiredAt(acquiredAt);
  const sourcePath = await privatePath(input);
  const source = parsePortalUsers(await readSource(sourcePath), exclusions);
  const current = await readSnapshots(
    ds.manager,
    source.rows.map((row) => row.empid),
    'empid',
  );
  const operations = planOperations(source, current);
  const body: Omit<PortalPreview, 'digest'> = {
    version: 1,
    kind: 'portal-users-preview',
    batchId: randomUUID(),
    target: await targetIdentity(ds.manager),
    sourcePath,
    sourceHash: source.sourceHash,
    acquiredAt: sourceAcquiredAt,
    previewedAt: new Date().toISOString(),
    exclusions,
    summary: summarize(source, operations),
    operations,
  };
  const preview = { ...body, digest: digest(JSON.stringify(body)) };
  await writePrivate(output, preview);
  return preview;
}
function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export async function loadPreview(path: string): Promise<PortalPreview> {
  const value = await readJson(path);
  if (
    !isObject(value) ||
    value.version !== 1 ||
    value.kind !== 'portal-users-preview' ||
    typeof value.digest !== 'string' ||
    typeof value.sourcePath !== 'string' ||
    !Array.isArray(value.exclusions) ||
    !Array.isArray(value.operations)
  )
    throw new PortalImportError('預覽檔案格式不合法');
  const { digest: expected, ...body } = value;
  if (digest(JSON.stringify(body)) !== expected)
    throw new PortalImportError('預覽檔案完整性檢查失敗');
  // 來源會重新嚴格解析，作業集合也會於鎖定後重新計算比對。
  return value as unknown as PortalPreview;
}
/** 用於 CLI 與隔離 DB 測試；不連線 Portal，也不啟動 HTTP 或 worker。 */
export async function applyPortalUsers(
  ds: DataSource,
  previewPath: string,
  output: string,
): Promise<PortalResult> {
  const preview = await loadPreview(previewPath);
  if (preview.target !== (await targetIdentity(ds.manager)))
    throw new PortalImportError('預覽與目標資料庫不一致');
  const source = parsePortalUsers(
    await readSource(preview.sourcePath),
    preview.exclusions,
  );
  if (source.sourceHash !== preview.sourceHash)
    throw new PortalImportError('預覽後來源已變更，請重新預覽');
  const target = await privatePath(output, true);
  // 同一份預覽只能嘗試一次；包含程序中斷的不確定結果，必須人工對帳或重新預覽。
  await writePrivate(`${previewPath}.apply-lock`, {
    batchId: preview.batchId,
    startedAt: new Date().toISOString(),
  });
  const prepared: PortalResult = {
    version: 1,
    kind: 'portal-users-result',
    batchId: preview.batchId,
    target: preview.target,
    previewHash: preview.digest,
    status: 'prepared',
    completedAt: null,
    summary: preview.summary,
    changes: [],
  };
  // 保留原值於不可覆寫的 intent 檔，檔案保存失敗絕不進行 DB 寫入。
  await writePrivate(`${target}.intent`, { preview, prepared });
  await writePrivate(target, prepared);
  const result = await ds.transaction(async (manager) => {
    const ids = preview.operations
      .flatMap((o) => (o.before ? [o.before.id] : []))
      .sort((a, b) => a - b);
    await readSnapshots(manager, ids, 'id', true);
    const current = await readSnapshots(
      manager,
      source.rows.map((row) => row.empid),
      'empid',
      true,
    );
    const operations = planOperations(source, current);
    if (
      !equal(operations, preview.operations) ||
      !equal(summarize(source, operations), preview.summary)
    )
      throw new PortalImportError('預覽後目標資料已變更，請重新預覽');
    const changedIds: number[] = [];
    for (const operation of operations) {
      if (operation.kind === 'noop' || operation.kind === 'protected') continue;
      const fields = operation.desired;
      const entity = manager.create(User, {
        ...fields,
        titleName: fields.titleName ?? undefined,
        isActive: true,
      });
      // TypeORM 的 nullable 型別未含 null；明確賦值避免把來源空值當 undefined 跳過。
      Object.assign(entity, { titleName: fields.titleName });
      if (operation.before) entity.id = operation.before.id;
      const saved = await users.save(entity, manager);
      changedIds.push(Number(saved.id));
    }
    const after = await readSnapshots(
      manager,
      changedIds.sort((a, b) => a - b),
      'id',
      true,
    );
    const beforeByEmpid = new Map(
      operations.map((o) => [o.desired.empid, o.before]),
    );
    const persisted: PortalResult = {
      ...prepared,
      changes: after.map((row) => ({
        before: beforeByEmpid.get(row.empid) ?? null,
        after: row,
      })),
    };
    // 先寫 prepared 結果；commit 若失敗保留此檔供對帳，不能視為已完成。
    await writePrivate(`${target}.prepared`, persisted);
    return persisted;
  });
  try {
    const applied: PortalResult = {
      ...result,
      status: 'applied',
      completedAt: new Date().toISOString(),
    };
    await writePrivate(`${target}.completed`, applied);
    await rename(`${target}.completed`, target);
    return applied;
  } catch {
    throw new PortalImportError(
      '資料庫已提交，但結果檔寫入失敗；請以 intent／prepared 檔人工對帳，勿重跑或宣稱已回滾',
    );
  }
}
