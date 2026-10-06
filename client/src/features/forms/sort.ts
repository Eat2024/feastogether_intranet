import { nextSortState, parseSortParams, sortByValue, type Sort, type SortValue } from '@/lib/tableSort';
import { deriveStatus, signedCount } from './status';
import type { EFormDoc, FormStatus } from './types';

export const SORT_KEYS = ['name', 'docNumber', 'startAt', 'endAt', 'status', 'progress', 'createdBy'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortState = Sort<SortKey>;

// 文件狀態依流程先後排序
export const STATUS_ORDER: Record<FormStatus, number> = { draft: 0, active: 1, completed: 2, stopped: 3 };

/** 各欄的排序值；null 表示沒有值，不論升冪或降冪都排在最後 */
const SORT_VALUE: Record<SortKey, (f: EFormDoc) => SortValue> = {
  name: (f) => f.name,
  docNumber: (f) => f.docNumber,
  startAt: (f) => f.startAt,
  // 已發起但未設結束日（不限）視為最晚；尚未發起才是無值
  endAt: (f) => f.endAt ?? (f.startAt ? '\uffff' : null),
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

/** 搜尋：文件名稱、文件編號、建立人姓名或員工編號包含關鍵字（不分大小寫） */
export function filterForms(forms: EFormDoc[], query: string): EFormDoc[] {
  const q = query.trim().toLowerCase();
  if (!q) return forms;
  return forms.filter((f) =>
    [f.name, f.docNumber ?? '', f.createdBy.name, f.createdBy.employeeNo].some((v) =>
      v.toLowerCase().includes(q),
    ),
  );
}

/** 組出列表網址，保留搜尋與排序條件 */
export function formsHref(opts: { query: string; sort: SortState }) {
  const qs = new URLSearchParams();
  if (opts.query) qs.set('q', opts.query);
  if (opts.sort) {
    qs.set('sort', opts.sort.key);
    qs.set('order', opts.sort.order);
  }
  const s = qs.toString();
  return s ? `/forms?${s}` : '/forms';
}
