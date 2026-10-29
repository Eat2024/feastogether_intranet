// 匯出簽署紀錄（後端文件）的條件、欄位與資料整理；條件記在網址上（格式與 mock 版相同），預覽與 Excel 共用。
// Excel 在瀏覽器端產生：匯出頁的資料來自文件詳情；歷史匯出的重新下載來自 GET /api/esign/history/export/:id/document。
// 產生前先以 POST /api/esign/history/export 記錄匯出（Spec 015）。
import type { EsignSignerStatus, EsignSignerView, ExcelExportField } from '@/api/types';
import dayjs from 'dayjs';

export const STATUS_OPTIONS = [
  { key: 'pending', label: '待簽署' },
  { key: 'signed', label: '已簽署' },
  { key: 'rejected', label: '已拒絕' },
] as const satisfies readonly { key: EsignSignerStatus; label: string }[];

const STATUS_LABEL: Record<EsignSignerStatus, string> = { pending: '待簽署', signed: '已簽署', rejected: '已拒絕' };

const formatTime = (iso: string | null) => (iso ? dayjs(iso).format('YYYY/MM/DD HH:mm') : '');

/** 產生 Excel 用到的簽署人欄位（文件詳情與歷史匯出的重新下載資料共有的欄位） */
export type ExportSigner = Pick<
  EsignSignerView,
  'type' | 'name' | 'employeeNo' | 'department' | 'title' | 'email' | 'status' | 'signedAt' | 'rejectedAt' | 'rejectReason'
>;

type FieldDef = {
  key: ExcelExportField;
  label: string;
  /** Excel 欄寬（字元數） */
  width: number;
  value: (s: ExportSigner) => string;
};

/** 可匯出的欄位（順序即 Excel 欄位順序）；與 mock 版相同，簽到表專用的欄位除外 */
export const FIELDS = [
  { key: 'name', label: '姓名', width: 14, value: (s) => s.name },
  // 員工編號以文字匯出，保留開頭的 0
  { key: 'employeeNo', label: '員工編號', width: 14, value: (s) => s.employeeNo ?? '' },
  { key: 'dept', label: '部門', width: 24, value: (s) => s.department ?? '' },
  { key: 'title', label: '職稱', width: 16, value: (s) => s.title ?? '' },
  { key: 'email', label: 'Email', width: 28, value: (s) => s.email ?? '' },
  { key: 'status', label: '狀態', width: 10, value: (s) => STATUS_LABEL[s.status] },
  { key: 'signedAt', label: '簽署時間', width: 18, value: (s) => formatTime(s.signedAt) },
  { key: 'rejectedAt', label: '拒絕時間', width: 18, value: (s) => formatTime(s.rejectedAt) },
  { key: 'rejectReason', label: '拒絕原因', width: 40, value: (s) => s.rejectReason ?? '' },
] as const satisfies readonly FieldDef[];

export type FieldKey = (typeof FIELDS)[number]['key'];
/** 預設勾選：與 mock 版相同 */
export const DEFAULT_FIELDS: FieldKey[] = ['name', 'employeeNo', 'dept', 'status', 'signedAt', 'rejectedAt', 'rejectReason'];

export type ExportQuery = {
  /** 空陣列表示全部狀態 */
  statuses: EsignSignerStatus[];
  /** 勾選的部門鍵（空陣列表示全部部門） */
  depts: string[];
  fields: FieldKey[];
};

const splitParam = (v: string | null) => (v ? v.split(',') : []);

export function parseExportQuery(params: URLSearchParams): ExportQuery {
  const statuses = splitParam(params.get('status')).filter((s): s is EsignSignerStatus =>
    STATUS_OPTIONS.some((o) => o.key === s),
  );
  const fieldKeys = new Set(splitParam(params.get('fields')));
  const fields = FIELDS.filter((f) => fieldKeys.has(f.key)).map((f) => f.key);
  return { statuses, depts: splitParam(params.get('depts')), fields: fields.length ? fields : DEFAULT_FIELDS };
}

// ── 部門 ──────────────────────────────────────────────
// 後端只有簽署人加入時的部門名稱快照（沒有組織架構的部門 id），因此依部門名稱分組

/** 部門選擇的節點（與 mock 版 DeptTreeSelect 相同格式） */
export type DeptNode = { id: string; name: string; count: number; children: DeptNode[] };

const EMAIL_GROUP = 'g:email';
const NO_DEPT = 'g:none';

// 部門名稱編碼後當鍵，避免名稱中的逗號與網址參數的分隔符號衝突
const deptKey = (name: string) => `d:${encodeURIComponent(name)}`;
const deptNameOf = (key: string) => decodeURIComponent(key.slice(2));

/** 簽署人歸屬的部門鍵 */
export function signerDeptKey(s: ExportSigner): string {
  if (s.type === 'email') return EMAIL_GROUP;
  return s.department ? deptKey(s.department) : NO_DEPT;
}

const collator = new Intl.Collator('zh-Hant-TW');

/** 這份文件簽署人所屬的部門（依名稱排序；以 Email 加入、沒有部門資料的分在最後） */
export function buildDeptOptions(signers: ExportSigner[]): DeptNode[] {
  const counts = new Map<string, number>();
  for (const s of signers) counts.set(signerDeptKey(s), (counts.get(signerDeptKey(s)) ?? 0) + 1);
  const depts = [...counts.entries()]
    .filter(([key]) => key.startsWith('d:'))
    .map(([key, count]) => ({ id: key, name: deptNameOf(key), count, children: [] }))
    .sort((a, b) => collator.compare(a.name, b.name));
  const groups = [
    { id: NO_DEPT, name: '沒有部門資料' },
    { id: EMAIL_GROUP, name: '以 Email 加入' },
  ].flatMap((g) => (counts.get(g.id) ? [{ ...g, count: counts.get(g.id)!, children: [] }] : []));
  return [...depts, ...groups];
}

/** 已勾選部門的名稱（文件資訊工作表、匯出範圍說明用） */
export function selectedDeptNames(ids: string[], options: DeptNode[]): string[] {
  const names = new Map(options.map((o) => [o.id, o.name]));
  return ids.map((id) => {
    if (names.has(id)) return names.get(id)!;
    try {
      return id.startsWith('d:') ? deptNameOf(id) : id;
    } catch {
      return id;
    }
  });
}

/** 套用匯出範圍，回傳要匯出的簽署人（維持後端順序） */
export function exportRows<T extends ExportSigner>(signers: T[], query: ExportQuery): T[] {
  const depts = new Set(query.depts);
  return signers.filter(
    (s) =>
      (query.statuses.length === 0 || query.statuses.includes(s.status)) &&
      (depts.size === 0 || depts.has(signerDeptKey(s))),
  );
}

// 匯出紀錄的範圍說明上限（後端 trim 後最多 2,000 字）
const SCOPE_MAX = 2000;

/** 匯出範圍的文字說明；部門很多時截斷，不超過後端上限 */
export function describeScope(query: ExportQuery, deptNames: string[]) {
  const statusText = query.statuses.length ? query.statuses.map((s) => STATUS_LABEL[s]).join('、') : '全部';
  const deptText = deptNames.length ? deptNames.join('、') : '全部';
  const text = `狀態：${statusText}；部門：${deptText}`;
  const chars = Array.from(text);
  return chars.length > SCOPE_MAX ? `${chars.slice(0, SCOPE_MAX - 1).join('')}…` : text;
}

/** 匯出頁網址；條件改變時不帶頁碼（回到預覽第 1 頁） */
export function exportPageHref(documentId: string, query: ExportQuery, page = 1) {
  const qs = new URLSearchParams();
  if (query.statuses.length) qs.set('status', query.statuses.join(','));
  if (query.depts.length) qs.set('depts', query.depts.join(','));
  if (query.fields.join(',') !== DEFAULT_FIELDS.join(',')) qs.set('fields', query.fields.join(','));
  if (page > 1) qs.set('page', String(page));
  const s = qs.toString();
  return s ? `/forms/${documentId}/export?${s}` : `/forms/${documentId}/export`;
}
