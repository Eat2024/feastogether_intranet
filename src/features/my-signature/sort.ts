import { STATUS_ORDER } from '@/features/forms/sort';
import { deriveStatus } from '@/features/forms/status';
import { parseSortParams, sortByValue, type Sort, type SortValue } from '@/lib/tableSort';
import type { MySignTab, MySignTask } from './tasks';

export type MySortKey =
  | 'name'
  | 'docNumber'
  | 'startAt'
  | 'endAt'
  | 'signedAt'
  | 'status'
  | 'rejectedAt'
  | 'rejectReason'
  | 'initiator';
export type MySortState = Sort<MySortKey>;

/** 各分頁可排序的欄位（切換分頁時排序會清除） */
export const SORT_KEYS_BY_TAB: Record<MySignTab, readonly MySortKey[]> = {
  pending: ['name', 'docNumber', 'startAt', 'endAt', 'initiator'],
  signed: ['name', 'docNumber', 'signedAt', 'status', 'initiator'],
  rejected: ['name', 'docNumber', 'rejectedAt', 'rejectReason', 'initiator'],
};

/** 各欄的排序值；null 表示沒有值，不論升冪或降冪都排在最後 */
const SORT_VALUE: Record<MySortKey, (t: MySignTask) => SortValue> = {
  name: ({ form }) => form.name,
  docNumber: ({ form }) => form.docNumber,
  startAt: ({ form }) => form.startAt,
  // 待簽署的文件都已發起，未設結束日（不限）視為最晚
  endAt: ({ form }) => form.endAt ?? '￿',
  signedAt: ({ me }) => me.signedAt ?? null,
  status: ({ form }) => STATUS_ORDER[deriveStatus(form)],
  rejectedAt: ({ me }) => me.rejectedAt ?? null,
  rejectReason: ({ me }) => me.rejectReason ?? null,
  initiator: ({ form }) => `${form.createdBy.name}\u0000${form.createdBy.employeeNo}`,
};

export function parseMySort(
  params: { sort?: string | string[]; order?: string | string[] },
  tab: MySignTab,
): MySortState {
  return parseSortParams(params, SORT_KEYS_BY_TAB[tab]);
}

/** 未指定排序時維持各分頁的預設順序（見 getMySignTasks） */
export function sortTasks(tasks: MySignTask[], sort: MySortState): MySignTask[] {
  return sort ? sortByValue(tasks, SORT_VALUE[sort.key], sort.order) : tasks;
}

export function mySignHref(tab: MySignTab, sort: { key: MySortKey; order: 'asc' | 'desc' }) {
  return `/my-signature?tab=${tab}&sort=${sort.key}&order=${sort.order}`;
}
