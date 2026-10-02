// 文件簽署狀態頁的簽署人篩選、排序與分頁（在伺服器端處理，條件記在網址上）
import { nextSortState, parseSortParams, sortByValue, type Sort, type SortValue } from '@/lib/tableSort';
import type { EFormDoc, Signer } from '../types';

export const PAGE_SIZE = 50;

export const STATUS_TABS = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待簽署' },
  { key: 'signed', label: '已簽署' },
  { key: 'rejected', label: '已拒絕' },
] as const;
export type StatusTab = (typeof STATUS_TABS)[number]['key'];

export const SIGNER_SORT_KEYS = ['name', 'dept', 'status', 'time', 'notify'] as const;
export type SignerSortKey = (typeof SIGNER_SORT_KEYS)[number];
export type SignerSort = Sort<SignerSortKey>;

// 狀態排序：待簽署 → 已簽署 → 已拒絕
const STATUS_ORDER: Record<Signer['status'], number> = { pending: 0, signed: 1, rejected: 2 };

/** 表格的一列：簽署人加上查得的部門 */
export type SignerRowData = Signer & { dept: string | null };

const SORT_VALUE: Record<SignerSortKey, (s: SignerRowData) => SortValue> = {
  name: (s) => s.name,
  dept: (s) => s.dept,
  status: (s) => STATUS_ORDER[s.status],
  time: (s) => s.signedAt ?? s.rejectedAt ?? null,
  notify: (s) => (s.notifyCount ? [s.notifyCount, 0] : null),
};

export type SignerQuery = { status: StatusTab; q: string; sort: SignerSort; page: number };

type Params = { status?: string | string[]; q?: string | string[]; sort?: string | string[]; order?: string | string[]; page?: string | string[] };

export function parseSignerQuery(params: Params): SignerQuery {
  const status = STATUS_TABS.some((t) => t.key === params.status) ? (params.status as StatusTab) : 'all';
  const q = typeof params.q === 'string' ? params.q.trim() : '';
  const page = Math.max(1, Number.parseInt(typeof params.page === 'string' ? params.page : '1', 10) || 1);
  return { status, q, sort: parseSortParams(params, SIGNER_SORT_KEYS), page };
}

/** 各狀態的人數（分頁標籤用；不受搜尋影響） */
export function countByStatus(form: EFormDoc): Record<StatusTab, number> {
  const count = (st: Signer['status']) => form.signers.filter((s) => s.status === st).length;
  return { all: form.signers.length, pending: count('pending'), signed: count('signed'), rejected: count('rejected') };
}

/** 套用狀態、搜尋、排序與分頁；回傳本頁資料與總筆數。deptOf 用來查簽署人的部門 */
export function querySigners(
  form: EFormDoc,
  query: SignerQuery,
  deptOf: (signerId: string) => string | null,
) {
  const q = query.q.toLowerCase();
  let rows: SignerRowData[] = form.signers.map((s) => ({ ...s, dept: deptOf(s.id) })).filter(
    (s) =>
      (query.status === 'all' || s.status === query.status) &&
      // 搜尋姓名、員工編號、部門
      (!q || [s.name, s.employeeNo, s.dept ?? ''].some((v) => v.toLowerCase().includes(q))),
  );
  if (query.sort) rows = sortByValue(rows, SORT_VALUE[query.sort.key], query.sort.order);
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  return { rows: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total, page, pageCount };
}

/** 組出本頁網址；未指定的條件沿用目前的值，換條件時回到第 1 頁 */
export function signerHref(formId: string, query: SignerQuery, change: Partial<SignerQuery>) {
  const next = { ...query, page: 1, ...change };
  const qs = new URLSearchParams();
  if (next.status !== 'all') qs.set('status', next.status);
  if (next.q) qs.set('q', next.q);
  if (next.sort) {
    qs.set('sort', next.sort.key);
    qs.set('order', next.sort.order);
  }
  if (next.page > 1) qs.set('page', String(next.page));
  const s = qs.toString();
  return s ? `/forms/${formId}?${s}` : `/forms/${formId}`;
}

export const nextSignerSort = nextSortState<SignerSortKey>;
