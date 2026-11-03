import { createHash } from 'node:crypto';
import { isEmail, isISO8601 } from 'class-validator';

export class PortalImportError extends Error {}

export const PORTAL_HEADER =
  'empid_hex\tname_hex\tdepartment_code_hex\tdepartment_name_hex\temail_hex\tperson_status\ttitle_name_hex';
export interface PortalUserFields {
  empid: string;
  name: string;
  departmentCode: string | null;
  departmentName: string | null;
  email: string | null;
  personStatus: string;
  titleName: string | null;
}
export interface PortalExclusion {
  employeeNo: string;
  reason: string;
}
export interface PortalSource {
  sourceHash: string;
  sourceRows: number;
  duplicateRows: number;
  excludedRows: number;
  ineligibleRows: number;
  rows: PortalUserFields[];
}
export function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
function decode(value: string): string | null {
  if (value === 'NULL') return null;
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(value))
    throw new PortalImportError('來源 HEX 格式不合法');
  return new TextDecoder('utf-8', { fatal: true }).decode(
    Buffer.from(value, 'hex'),
  );
}
function optional(value: string | null, max: number): string | null {
  const normalized = value?.trim() || null;
  if (
    normalized &&
    (Array.from(normalized).length > max || normalized.includes('\0'))
  )
    throw new PortalImportError('來源欄位長度或內容不合法');
  return normalized;
}
export function parsePortalUsers(
  input: Buffer,
  exclusions: PortalExclusion[] = [],
): PortalSource {
  const excluded = new Set<string>();
  for (const entry of exclusions) {
    if (
      !entry ||
      typeof entry.employeeNo !== 'string' ||
      !/^[A-Za-z0-9]{1,20}$/.test(entry.employeeNo) ||
      typeof entry.reason !== 'string' ||
      !entry.reason.trim() ||
      excluded.has(entry.employeeNo)
    )
      throw new PortalImportError('排除名單必須包含唯一完整員編與理由');
    excluded.add(entry.employeeNo);
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(input);
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.shift() !== PORTAL_HEADER || !lines.length)
    throw new PortalImportError('來源欄位或資料列缺漏');
  const result: PortalSource = {
    sourceHash: digest(input),
    sourceRows: lines.length,
    duplicateRows: 0,
    excludedRows: 0,
    ineligibleRows: 0,
    rows: [],
  };
  const byId = new Map<string, PortalUserFields>();
  const cases = new Map<string, string>();
  const seenRows = new Map<string, string>();
  for (const line of lines) {
    const fields = line.split('\t');
    if (fields.length !== 7) throw new PortalImportError('來源欄位數不正確');
    const [empid, name, departmentCode, departmentName, email, titleName] = [
      0, 1, 2, 3, 4, 6,
    ].map((index) => decode(fields[index]));
    if (!empid || !/^[A-Za-z0-9]{1,20}$/.test(empid))
      throw new PortalImportError('來源完整員編不合法');
    if (!/^\d+$/.test(fields[5]))
      throw new PortalImportError('來源狀態格式不合法');
    if (excluded.has(empid)) {
      result.excludedRows++;
      continue;
    }
    const caseId = cases.get(empid.toLowerCase());
    if (caseId && caseId !== empid)
      throw new PortalImportError('來源員編大小寫衝突');
    cases.set(empid.toLowerCase(), empid);
    const fingerprint = JSON.stringify([
      empid,
      name?.trim() || null,
      departmentCode?.trim() || null,
      departmentName?.trim() || null,
      email?.trim().toLowerCase() || null,
      fields[5],
      titleName?.trim() || null,
    ]);
    const prior = seenRows.get(empid);
    if (prior !== undefined) {
      if (prior !== fingerprint)
        throw new PortalImportError('來源同員編資料衝突');
      result.duplicateRows++;
      continue;
    }
    seenRows.set(empid, fingerprint);
    if (!['0', '1'].includes(fields[5])) {
      result.ineligibleRows++;
      continue;
    }
    const normalizedName = optional(name, 100);
    if (!normalizedName) throw new PortalImportError('來源缺少姓名');
    const normalizedEmail = optional(email, 255)?.toLowerCase() ?? null;
    if (normalizedEmail && !isEmail(normalizedEmail))
      throw new PortalImportError('來源非空信箱不合法');
    const row: PortalUserFields = {
      empid,
      name: normalizedName,
      departmentCode: optional(departmentCode, 50),
      departmentName: optional(departmentName, 150),
      email: normalizedEmail,
      personStatus: fields[5] === '0' ? '試用' : '正式',
      titleName: optional(titleName, 100),
    };
    byId.set(empid, row);
  }
  result.rows = [...byId.values()].sort((a, b) =>
    a.empid.localeCompare(b.empid, 'en'),
  );
  return result;
}

/** 由維運提供真正取得來源的時間，不能以預覽時間或 mtime 取代。 */
export function validateAcquiredAt(value: string): string {
  if (
    typeof value !== 'string' ||
    !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !isISO8601(value, { strict: true, strictSeparator: true }) ||
    !Number.isFinite(Date.parse(value)) ||
    Date.parse(value) > Date.now()
  )
    throw new PortalImportError(
      '來源取得時間必須為含時區且不在未來的 ISO 時間',
    );
  return new Date(value).toISOString();
}
