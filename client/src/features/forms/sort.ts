import { nextSortState, parseSortParams, sortByValue, type Sort, type SortValue } from '@/lib/tableSort';
import { deriveStatus, signedCount, signingPeriod } from './status';
import type { EFormDoc, FormStatus } from './types';

export const SORT_KEYS = ['name', 'docNumber', 'startAt', 'endAt', 'status', 'progress', 'createdBy'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortState = Sort<SortKey>;

// 文件狀態依流程先後排序
export const STATUS_ORDER: Record<FormStatus, number> = { draft: 0, active: 1, expired: 2, completed: 3, stopped: 4 };

/** 各欄的排序值；null 表示沒有值，不論升冪或降冪都排在最後 */
const SORT_VALUE: Record<SortKey, (f: EFormDoc) => SortValue> = {
  name: (f) => f.name,
  docNumber: (f) => f.docNumber,
  startAt: (f) => f.startAt,
  // 已發起但未設結束日（不限）視為最晚；尚未發起才是無值
  // 依目前的簽署期間（補簽中為補簽結束日）
  endAt: (f) => signingPeriod(f).endAt ?? (f.startAt ? '\uffff' : null),
  status: (f) => STATUS_ORDER[deriveStatus(f)],
  // 依完成比例，再依已簽人數；沒有簽署人視為無值
  progress: (f) => (f.signers.length ? [signedCount(f) / f.signers.length, signedCount(f)] : null),
  createdBy: (f) => `${f.createdBy.name}\u0000${f.createdBy.employeeNo}`,
};

export function parseSort(params: { sort?: string | string[]; order?: string | string[] }): SortState {
  return parseSortParams(params, SORT_KEYS);
}

/** 回傳排序後的新陣列；未指定排序時維持原順序（新建立的在最上面） */
export function sortForms(forms: EFormDoc[], sort: SortState): EFormDoc[] {
  return sort ? sortByValue(forms, SORT_VALUE[sort.key], sort.order) : forms;
}

export const nextSort = nextSortState<SortKey>;

export const FORM_STATUSES = ['draft', 'active', 'expired', 'completed', 'stopped'] as const satisfies readonly FormStatus[];

/** 列表的搜尋與篩選條件（記在網址上；日期為 YYYY-MM-DD，null 表示不限） */
export type FormFilters = {
  query: string;
  /** 空陣列表示全部狀態 */
  statuses: FormStatus[];
  from: string | null;
  to: string | null;
};

type FilterParams = { q?: string | string[]; status?: string | string[]; from?: string | string[]; to?: string | string[] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateParam = (v: string | string[] | undefined) => (typeof v === 'string' && ISO_DATE.test(v) ? v : null);

export function parseFilters(params: FilterParams): FormFilters {
  const statuses = typeof params.status === 'string' ? params.status.split(',') : [];
  let from = dateParam(params.from);
  let to = dateParam(params.to);
  // 起日晚於迄日時對調，避免整個列表變空
  if (from && to && from > to) [from, to] = [to, from];
  return {
    query: typeof params.q === 'string' ? params.q.trim() : '',
    statuses: FORM_STATUSES.filter((s) => statuses.includes(s)),
    from,
    to,
  };
}

export const hasFilters = (f: FormFilters) => !!(f.query || f.statuses.length || f.from || f.to);

/** 資料日期 YYYY/MM/DD 轉成可與網址日期比較的 YYYY-MM-DD */
const iso = (d: string) => d.replaceAll('/', '-');

/**
 * 篩選：
 * - 關鍵字：文件名稱、建立人姓名或員工編號包含關鍵字（不分大小寫）
 * - 狀態：符合任一勾選的文件狀態
 * - 簽署期間：與指定日期區間有重疊（未設結束日視為不限；補簽中以補簽結束日為準）；尚未發起的草稿沒有簽署期間，不會列出
 */
export function filterForms(forms: EFormDoc[], filters: FormFilters): EFormDoc[] {
  const q = filters.query.toLowerCase();
  return forms.filter((f) => {
    if (
      q &&
      ![f.name, f.createdBy.name, f.createdBy.employeeNo].some((v) => v.toLowerCase().includes(q))
    )
      return false;
    if (filters.statuses.length && !filters.statuses.includes(deriveStatus(f))) return false;
    if (filters.from || filters.to) {
      if (!f.startAt) return false;
      if (filters.to && iso(f.startAt) > filters.to) return false;
      const endAt = signingPeriod(f).endAt;
      if (filters.from && endAt && iso(endAt) < filters.from) return false;
    }
    return true;
  });
}

/** 組出列表網址，保留搜尋、篩選與排序條件；未指定頁碼時回到第 1 頁 */
export function formsHref(opts: { filters: FormFilters; sort: SortState; page?: number }) {
  const { filters, sort, page = 1 } = opts;
  const qs = new URLSearchParams();
  if (filters.query) qs.set('q', filters.query);
  if (filters.statuses.length) qs.set('status', filters.statuses.join(','));
  if (filters.from) qs.set('from', filters.from);
  if (filters.to) qs.set('to', filters.to);
  if (sort) {
    qs.set('sort', sort.key);
    qs.set('order', sort.order);
  }
  if (page > 1) qs.set('page', String(page));
  const s = qs.toString();
  return s ? `/forms?${s}` : '/forms';
}
