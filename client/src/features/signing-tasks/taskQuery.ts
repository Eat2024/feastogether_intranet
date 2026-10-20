// 我的電子簽（後端資料）的分頁、可否簽署、排序與網址規則。
// 後端 GET /api/esign/signing-tasks 不分頁、不排序，這些都在前端依網址參數處理。
import type { EsignSigningTask } from '@/api/types';
import { DOCUMENT_STATUSES, formatDate } from '@/features/esign-documents/listQuery';
import { parseSortParams, sortByValue, type Sort, type SortValue } from '@/lib/tableSort';
import dayjs from 'dayjs';

export type SigningTab = 'pending' | 'signed' | 'rejected';

/** unsupported：後端尚未支援，分頁保留但標示，且不會有資料 */
export const SIGNING_TABS: { key: SigningTab; label: string; unsupported?: boolean }[] = [
  { key: 'pending', label: '待簽署' },
  { key: 'signed', label: '已簽署' },
  // TODO: 後端支援拒絕簽署後，依簽署人的拒絕紀錄列出
  { key: 'rejected', label: '已拒絕', unsupported: true },
];

export function parseSigningTab(value: string | null): SigningTab {
  return SIGNING_TABS.some((t) => t.key === value) ? (value as SigningTab) : 'pending';
}

/** ISO 時間轉成畫面時間 YYYY/MM/DD HH:mm（本地時區） */
export const formatDateTime = (iso: string | null) => (iso ? dayjs(iso).format('YYYY/MM/DD HH:mm') : null);

/**
 * 依分頁整理任務並排出預設順序：
 * 待簽署為本人未簽、文件簽署中或已到期（已到期仍列出，顯示已逾期、等待補簽），依結束時間由近到遠；
 * 已停止、已完成的文件不再列為待簽署。已簽署依簽署時間由新到舊。
 */
export function splitTasks(tasks: EsignSigningTask[]): Record<SigningTab, EsignSigningTask[]> {
  return {
    pending: tasks
      .filter((t) => t.signer.status === 'pending' && (t.document.status === 'active' || t.document.status === 'expired'))
      .sort((a, b) => (a.document.signEndAt ?? '￿').localeCompare(b.document.signEndAt ?? '￿')),
    signed: tasks
      .filter((t) => t.signer.status === 'signed')
      .sort((a, b) => (b.signer.signedAt ?? '').localeCompare(a.signer.signedAt ?? '')),
    // 後端尚未支援拒絕簽署
    rejected: [],
  };
}

/**
 * 目前不能簽署的原因；可以簽署時回傳 null（列表的簽署按鈕與簽署頁共用）。
 * 規則與後端相同：文件須為簽署中，且在簽署開始與結束時間之間；送出時後端會再檢查一次。
 */
export function signBlock(task: EsignSigningTask, now: Date): string | null {
  const { document: doc, signer } = task;
  if (signer.status === 'signed') return `你已於 ${formatDateTime(signer.signedAt) ?? '—'} 完成簽署。`;
  if (doc.status === 'stopped') return '此文件已停止簽署，無法再簽署。';
  const expired = doc.status === 'expired' || (doc.signEndAt !== null && now >= new Date(doc.signEndAt));
  if (expired) {
    const contact = doc.createdBy ? `建立人 ${doc.createdBy.name}` : '建立人';
    return `已超過簽署期限（${formatDate(doc.signEndAt) ?? '—'}），無法簽署，如有需要請聯絡${contact}。`;
  }
  if (doc.status !== 'active') return '此文件目前無法簽署。';
  if (!task.fields.some((f) => f.type === 'signature')) return '此文件沒有可簽署的內容，請聯絡建立人。';
  if (doc.signStartAt && now < new Date(doc.signStartAt)) {
    return `${doc.isReopened ? '補簽' : '簽署'}期間自 ${formatDate(doc.signStartAt)} 開始，目前尚無法簽署。`;
  }
  return null;
}

// ── 排序 ──────────────────────────────────────────────

export type SigningSortKey = 'name' | 'docNumber' | 'startAt' | 'endAt' | 'signedAt' | 'status' | 'initiator';
export type SigningSort = Sort<SigningSortKey>;

/** 各分頁可排序的欄位（切換分頁時排序會清除） */
export const SORT_KEYS_BY_TAB: Record<SigningTab, readonly SigningSortKey[]> = {
  pending: ['name', 'docNumber', 'startAt', 'endAt', 'initiator'],
  signed: ['name', 'docNumber', 'signedAt', 'status', 'initiator'],
  // 後端尚未支援拒絕簽署，沒有資料可排序
  rejected: [],
};

/** 各欄的排序值；null 表示沒有值，不論升冪或降冪都排在最後（ISO 時間可直接以字串比較） */
const SORT_VALUE: Record<SigningSortKey, (t: EsignSigningTask) => SortValue> = {
  name: ({ document }) => document.title,
  docNumber: ({ document }) => document.docNumber,
  startAt: ({ document }) => document.signStartAt,
  // 未設結束時間（不限）視為最晚
  endAt: ({ document }) => document.signEndAt ?? '￿',
  signedAt: ({ signer }) => signer.signedAt,
  status: ({ document }) => DOCUMENT_STATUSES.indexOf(document.status),
  initiator: ({ document }) =>
    document.createdBy ? `${document.createdBy.name}\u0000${document.createdBy.employeeNo}` : null,
};

export function parseSigningSort(params: URLSearchParams, tab: SigningTab): SigningSort {
  return parseSortParams(
    { sort: params.get('sort') ?? undefined, order: params.get('order') ?? undefined },
    SORT_KEYS_BY_TAB[tab],
  );
}

/** 未指定排序時維持各分頁的預設順序（見 splitTasks） */
export function sortTasks(tasks: EsignSigningTask[], sort: SigningSort): EsignSigningTask[] {
  return sort ? sortByValue(tasks, SORT_VALUE[sort.key], sort.order) : tasks;
}

/** 未指定頁碼時回到第 1 頁 */
export function signingHref(tab: SigningTab, sort: SigningSort, page = 1) {
  const qs = new URLSearchParams({ tab });
  if (sort) {
    qs.set('sort', sort.key);
    qs.set('order', sort.order);
  }
  if (page > 1) qs.set('page', String(page));
  return `/my-signature?${qs}`;
}

/** 簽署頁返回時停在這份文件所屬的分頁（後端尚未支援拒絕簽署，不會停在已拒絕） */
export const backHref = (task: EsignSigningTask) =>
  task.signer.status === 'signed' ? '/my-signature?tab=signed' : '/my-signature';
