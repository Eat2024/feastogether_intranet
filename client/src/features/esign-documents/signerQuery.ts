// 檢視頁（後端文件）簽署人清單的狀態分頁、搜尋、排序與分頁；條件記在網址上，在瀏覽器端處理
import type { EsignSignerStatus, EsignSignerView } from '@/api/types';
import { PAGE_SIZE, paginate, parsePage } from '@/lib/paginate';
import { nextSortState, parseSortParams, sortByValue, type Sort, type SortValue } from '@/lib/tableSort';

export const SIGNER_STATUS_TABS = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待簽署' },
  { key: 'signed', label: '已簽署' },
  { key: 'rejected', label: '已拒絕' },
] as const;
export type SignerStatusTab = (typeof SIGNER_STATUS_TABS)[number]['key'];

export const SIGNER_SORT_KEYS = ['name', 'dept', 'status', 'time'] as const;
export type SignerSortKey = (typeof SIGNER_SORT_KEYS)[number];
export type SignerSort = Sort<SignerSortKey>;

// 狀態排序：待簽署 → 已簽署 → 已拒絕
const STATUS_ORDER: Record<EsignSignerStatus, number> = { pending: 0, signed: 1, rejected: 2 };

const SORT_VALUE: Record<SignerSortKey, (s: EsignSignerView) => SortValue> = {
  name: (s) => s.name,
  dept: (s) => s.department,
  status: (s) => STATUS_ORDER[s.status],
  time: (s) => s.signedAt,
};

export type SignerQuery = { status: SignerStatusTab; q: string; sort: SignerSort; page: number };

export function parseSignerQuery(params: URLSearchParams): SignerQuery {
  const status = params.get('status');
  return {
    status: SIGNER_STATUS_TABS.find((t) => t.key === status)?.key ?? 'all',
    q: (params.get('q') ?? '').trim(),
    sort: parseSortParams(
      { sort: params.get('sort') ?? undefined, order: params.get('order') ?? undefined },
      SIGNER_SORT_KEYS,
    ),
    page: parsePage(params.get('page') ?? undefined),
  };
}

/** 各狀態的人數（分頁標籤用；不受搜尋影響） */
export function countByStatus(signers: EsignSignerView[]): Record<SignerStatusTab, number> {
  const count = (st: EsignSignerStatus) => signers.filter((s) => s.status === st).length;
  return { all: signers.length, pending: count('pending'), signed: count('signed'), rejected: count('rejected') };
}

/** 套用狀態、搜尋（姓名、員編、Email、部門）、排序與分頁；未指定排序時維持後端順序 */
export function querySigners<T extends EsignSignerView>(signers: T[], query: SignerQuery) {
  const q = query.q.toLowerCase();
  let rows = signers.filter(
    (s) =>
      (query.status === 'all' || s.status === query.status) &&
      (!q || [s.name, s.employeeNo, s.email, s.department].some((v) => v?.toLowerCase().includes(q))),
  );
  if (query.sort) rows = sortByValue(rows, SORT_VALUE[query.sort.key], query.sort.order);
  return { ...paginate(rows, query.page, PAGE_SIZE), total: rows.length };
}

/** 組出檢視頁網址；未指定的條件沿用目前的值，換條件時回到第 1 頁 */
export function signerHref(documentId: string, query: SignerQuery, change: Partial<SignerQuery>) {
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
  return s ? `/forms/${documentId}?${s}` : `/forms/${documentId}`;
}

export const nextSignerSort = nextSortState<SignerSortKey>;
