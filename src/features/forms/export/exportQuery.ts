// 匯出頁的條件（範圍、欄位）與資料整理；條件記在網址上，預覽與 Excel 檔案共用同一套規則
import type { EFormDoc, Signer } from '../types';

export const PREVIEW_ROWS = 10;

export const STATUS_OPTIONS = [
  { key: 'pending', label: '待簽署' },
  { key: 'signed', label: '已簽署' },
  { key: 'rejected', label: '已拒絕' },
] as const satisfies readonly { key: Signer['status']; label: string }[];

const STATUS_LABEL: Record<Signer['status'], string> = { pending: '待簽署', signed: '已簽署', rejected: '已拒絕' };

export type ExportRow = Signer & { dept: string | null };

type FieldDef = {
  key: string;
  label: string;
  /** Excel 欄寬（字元數） */
  width: number;
  value: (row: ExportRow) => string | number;
};

/** 可匯出的欄位（順序即 Excel 欄位順序） */
export const FIELDS = [
  { key: 'name', label: '姓名', width: 14, value: (r) => r.name },
  // 員工編號以文字匯出，保留開頭的 0
  { key: 'employeeNo', label: '員工編號', width: 14, value: (r) => r.employeeNo },
  { key: 'dept', label: '部門', width: 24, value: (r) => r.dept ?? '' },
  { key: 'email', label: 'Email', width: 28, value: (r) => r.email ?? '' },
  { key: 'status', label: '狀態', width: 10, value: (r) => STATUS_LABEL[r.status] },
  { key: 'signedAt', label: '簽署時間', width: 18, value: (r) => r.signedAt ?? '' },
  { key: 'rejectedAt', label: '拒絕時間', width: 18, value: (r) => r.rejectedAt ?? '' },
  { key: 'rejectReason', label: '拒絕原因', width: 40, value: (r) => r.rejectReason ?? '' },
] as const satisfies readonly FieldDef[];

export type FieldKey = (typeof FIELDS)[number]['key'];
export const DEFAULT_FIELDS: FieldKey[] = ['name', 'employeeNo', 'dept', 'status', 'signedAt', 'rejectedAt', 'rejectReason'];

export type ExportQuery = {
  /** 空陣列表示全部狀態 */
  statuses: Signer['status'][];
  /** 勾選的最上層部門 id（空陣列表示全部部門）；伺服器端會展開為所有下層部門 */
  depts: string[];
  fields: FieldKey[];
};

type Params = { status?: string | string[]; depts?: string | string[]; fields?: string | string[] };

const splitParam = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v.split(',') : []);

export function parseExportQuery(params: Params): ExportQuery {
  const statuses = splitParam(params.status).filter((s): s is Signer['status'] =>
    STATUS_OPTIONS.some((o) => o.key === s),
  );
  const fieldKeys = new Set(splitParam(params.fields));
  const fields = fieldKeys.size
    ? FIELDS.filter((f) => fieldKeys.has(f.key)).map((f) => f.key)
    : DEFAULT_FIELDS;
  return { statuses, depts: splitParam(params.depts), fields: fields.length ? fields : DEFAULT_FIELDS };
}

/**
 * 套用匯出範圍，回傳要匯出的列。
 * deptOf 查部門名稱；deptKeyOf 查部門鍵；deptKeys 為勾選部門展開後的所有部門鍵（null 表示全部部門）
 */
export function exportRows(
  form: EFormDoc,
  query: ExportQuery,
  helpers: {
    deptOf: (signerId: string) => string | null;
    deptKeyOf: (signer: Signer) => string;
    deptKeys: Set<string> | null;
  },
): ExportRow[] {
  return form.signers
    .filter(
      (s) =>
        (query.statuses.length === 0 || query.statuses.includes(s.status)) &&
        (!helpers.deptKeys || helpers.deptKeys.has(helpers.deptKeyOf(s))),
    )
    .map((s) => ({ ...s, dept: helpers.deptOf(s.id) }));
}

/** 匯出範圍的文字說明（Excel 的「文件資訊」與匯出紀錄共用） */
export function describeScope(query: ExportQuery, deptNames: string[]) {
  const statusText = query.statuses.length
    ? query.statuses.map((s) => STATUS_LABEL[s]).join('、')
    : '全部';
  const deptText = deptNames.length ? `${deptNames.join('、')}（含下層部門）` : '全部';
  return `狀態：${statusText}；部門：${deptText}`;
}

function toSearch(query: ExportQuery) {
  const qs = new URLSearchParams();
  if (query.statuses.length) qs.set('status', query.statuses.join(','));
  if (query.depts.length) qs.set('depts', query.depts.join(','));
  if (query.fields.join(',') !== DEFAULT_FIELDS.join(',')) qs.set('fields', query.fields.join(','));
  return qs.toString();
}

/** 匯出頁網址（條件改變時用） */
export function exportPageHref(formId: string, query: ExportQuery) {
  const s = toSearch(query);
  return s ? `/forms/${formId}/export?${s}` : `/forms/${formId}/export`;
}

/** 下載 Excel 檔案的網址 */
export function exportFileHref(formId: string, query: ExportQuery) {
  const s = toSearch(query);
  return s ? `/forms/${formId}/export/file?${s}` : `/forms/${formId}/export/file`;
}
