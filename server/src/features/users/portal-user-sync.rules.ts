import { isEmail } from 'class-validator';
import type {
  PortalActiveEmployeeRow,
  PortalStatusRow,
} from '#app/infrastructure/portal/portal.types';
import type { User } from './entities/user.entity';

/** 匯入寫入本機 users 的欄位（data-model「本機 users：匯入寫入的欄位」）。 */
/**
 * 單次匯入最多停用的人數（research §6）：約為歷史單日離職高峰的三倍。
 * 超過時每日匯入整批不寫入；手動 CLI 須明確確認本次停用人數。
 */
export const PORTAL_USER_DEACTIVATION_LIMIT = 500;

export type PortalUserSyncTrigger = 'schedule' | 'manual';

/** 回傳給呼叫端的結果；失敗（failed_source／failed_write）時 run 會拋錯，不回傳摘要。 */
export type PortalUserSyncOutcome =
  | 'applied'
  | 'dry_run'
  | 'blocked_deactivation_threshold';

/** 匯入結果摘要（data-model），只含計數，不含員編、姓名、Email 等個資。 */
export interface PortalUserSyncSummary {
  trigger: PortalUserSyncTrigger;
  sourceAcquiredAt: string;
  sourceRows: number;
  eligibleEmployees: number;
  created: number;
  updated: number;
  unchanged: number;
  protected: number;
  deactivated: number;
  skipped: Record<PortalUserSkipReason, number>;
  outcome: PortalUserSyncOutcome;
}

export interface PortalUserFields {
  empid: string;
  name: string;
  departmentCode: string | null;
  departmentName: string | null;
  email: string | null;
  personStatus: string;
  titleName: string | null;
}

export type PortalUserSkipReason =
  | 'missing_name'
  | 'invalid_email'
  | 'too_long'
  | 'invalid_empid'
  | 'conflict';

/** 被略過的員編與原因；只給 CLI 印到操作者終端機，不可寫進 log。 */
export interface SkippedPortalEmployee {
  empid: string;
  reason: PortalUserSkipReason;
}

export interface PortalUserSource {
  employees: PortalUserFields[];
  skipped: SkippedPortalEmployee[];
}

const EMPID = /^[A-Za-z0-9]{1,20}$/;

// 本機 users 欄位長度上限，以字元（code point）計，與 MySQL varchar 相同。
const MAX_LENGTH = {
  name: 100,
  departmentCode: 50,
  departmentName: 150,
  email: 255,
  titleName: 100,
} as const;

const optional = (value: string): string | null => value.trim() || null;

function toFields(
  row: PortalActiveEmployeeRow,
): PortalUserFields | PortalUserSkipReason {
  const fields: PortalUserFields = {
    empid: row.person_empid,
    name: row.person_name.trim(),
    departmentCode: optional(row.department_id),
    departmentName: optional(row.department_name),
    email: optional(row.email)?.toLowerCase() ?? null,
    personStatus: row.person_status === 0 ? '試用' : '正式',
    titleName: optional(row.title),
  };
  if (!fields.name) return 'missing_name';
  for (const [key, max] of Object.entries(MAX_LENGTH)) {
    const value = fields[key as keyof typeof MAX_LENGTH];
    if (value && Array.from(value).length > max) return 'too_long';
  }
  if (fields.email && !isEmail(fields.email)) return 'invalid_email';
  return fields;
}

/**
 * 把 Portal 在職資料列轉成本機欄位；不合法或衝突的員編個別略過，不影響其他人。
 * 同員編正規化後完全相同的列合併；內容不同，或員編只差大小寫（Portal 與本機的 collation 都不分大小寫），
 * 都算 conflict，不取任何一筆。
 */
export function normalizePortalEmployees(
  rows: readonly PortalActiveEmployeeRow[],
): PortalUserSource {
  type Variants = Map<string, PortalUserFields | PortalUserSkipReason>;
  const byEmpid = new Map<string, Variants>();
  for (const row of rows) {
    const result = EMPID.test(row.person_empid)
      ? toFields(row)
      : 'invalid_empid';
    const variants = byEmpid.get(row.person_empid) ?? (new Map() as Variants);
    variants.set(JSON.stringify(result), result);
    byEmpid.set(row.person_empid, variants);
  }
  const caseCounts = new Map<string, number>();
  for (const empid of byEmpid.keys()) {
    const key = empid.toLowerCase();
    caseCounts.set(key, (caseCounts.get(key) ?? 0) + 1);
  }

  const source: PortalUserSource = { employees: [], skipped: [] };
  for (const [empid, variants] of byEmpid) {
    const [result] = variants.values();
    if (variants.size > 1 || caseCounts.get(empid.toLowerCase())! > 1) {
      source.skipped.push({ empid, reason: 'conflict' });
    } else if (typeof result === 'string') {
      source.skipped.push({ empid, reason: result });
    } else {
      source.employees.push(result);
    }
  }
  return source;
}

/**
 * Portal 有這個員編、但沒有任何 0／1 資料列的人（data-model「deactivate」）。
 * 查不到的員編不在結果中；在職名單與狀態查詢之間恢復在職的人也不算。
 * 狀態查詢不分大小寫，呼叫端須以 === 對應本機員編。
 */
export function findDepartedEmpids(
  statuses: readonly PortalStatusRow[],
): Set<string> {
  const active = new Set<string>();
  const departed = new Set<string>();
  for (const { person_empid, person_status } of statuses) {
    if (person_status === 0 || person_status === 1) active.add(person_empid);
    else departed.add(person_empid);
  }
  return new Set([...departed].filter((empid) => !active.has(empid)));
}

export type PortalUserOperation =
  | { kind: 'create'; fields: PortalUserFields }
  | { kind: 'update'; user: User; fields: PortalUserFields }
  | { kind: 'noop' | 'protected' | 'deactivate'; user: User };

export interface PortalUserSyncPlan {
  operations: PortalUserOperation[];
  skipped: SkippedPortalEmployee[];
}

const COMPARED_FIELDS = [
  'name',
  'departmentCode',
  'departmentName',
  'email',
  'personStatus',
  'titleName',
] as const;

/**
 * 依鎖定後的本機資料規劃每個員編的作業（data-model「匯入分類」）。
 * users 須含 email，並包含本機與 Portal 員編只差大小寫的資料列；departed 由 findDepartedEmpids 算出。
 * 已停用或軟刪除的帳號一律不寫入，也不恢復；本機在 Portal 查不到的人不在 departed 中，所以不動。
 */
export function planPortalUserSync(
  source: PortalUserSource,
  users: readonly User[],
  departed: ReadonlySet<string>,
): PortalUserSyncPlan {
  const byEmpid = new Map(users.map((user) => [user.empid, user]));
  const caseInsensitive = new Set(users.map((u) => u.empid.toLowerCase()));
  const plan: PortalUserSyncPlan = {
    operations: [],
    skipped: [...source.skipped],
  };
  for (const fields of source.employees) {
    const user = byEmpid.get(fields.empid);
    if (!user) {
      // 本機 empid 的 collation 不分大小寫，建立只差大小寫的員編會撞唯一鍵。
      if (caseInsensitive.has(fields.empid.toLowerCase())) {
        plan.skipped.push({ empid: fields.empid, reason: 'conflict' });
      } else {
        plan.operations.push({ kind: 'create', fields });
      }
    } else if (!user.isActive || user.deletedAt) {
      plan.operations.push({ kind: 'protected', user });
    } else if (COMPARED_FIELDS.every((key) => user[key] === fields[key])) {
      plan.operations.push({ kind: 'noop', user });
    } else {
      plan.operations.push({ kind: 'update', user, fields });
    }
  }
  for (const user of users) {
    if (departed.has(user.empid) && user.isActive && !user.deletedAt) {
      plan.operations.push({ kind: 'deactivate', user });
    }
  }
  return plan;
}

const countOf = (plan: PortalUserSyncPlan, kind: PortalUserOperation['kind']) =>
  plan.operations.filter((op) => op.kind === kind).length;

/** 停用人數超過門檻，且確認人數不等於本次停用人數時，整批不寫入。 */
export function isDeactivationBlocked(
  plan: PortalUserSyncPlan,
  confirmedDeactivations?: number,
): boolean {
  const deactivations = countOf(plan, 'deactivate');
  return (
    deactivations > PORTAL_USER_DEACTIVATION_LIMIT &&
    confirmedDeactivations !== deactivations
  );
}

export function summarizePortalUserSync(
  plan: PortalUserSyncPlan,
  context: Pick<
    PortalUserSyncSummary,
    'trigger' | 'sourceAcquiredAt' | 'sourceRows' | 'outcome'
  >,
): PortalUserSyncSummary {
  const skipped: Record<PortalUserSkipReason, number> = {
    missing_name: 0,
    invalid_email: 0,
    too_long: 0,
    invalid_empid: 0,
    conflict: 0,
  };
  for (const { reason } of plan.skipped) skipped[reason]++;
  const deactivated = countOf(plan, 'deactivate');
  return {
    trigger: context.trigger,
    sourceAcquiredAt: context.sourceAcquiredAt,
    sourceRows: context.sourceRows,
    eligibleEmployees: plan.operations.length - deactivated,
    created: countOf(plan, 'create'),
    updated: countOf(plan, 'update'),
    unchanged: countOf(plan, 'noop'),
    protected: countOf(plan, 'protected'),
    deactivated,
    skipped,
    outcome: context.outcome,
  };
}
