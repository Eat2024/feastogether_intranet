// 電子簽列表（後端資料）的狀態顯示、搜尋、篩選、排序與網址規則。
// 後端 GET /api/esign/documents 不分頁、不搜尋，這些都在前端依網址參數處理（與原本 mock 列表的網址格式相同）。
import type { EsignDocumentListItem } from '@/api/types';
import { parseSortParams, sortByValue, type Sort, type SortValue } from '@/lib/tableSort';
import type { ChipProps } from '@mui/material/Chip';
import dayjs from 'dayjs';

/** 列表顯示的狀態：後端狀態，加上由簽署期間推導的「已到期」 */
export type DocumentListStatus = 'draft' | 'active' | 'expired' | 'finalizing' | 'completed' | 'stopped';

export const DOCUMENT_STATUS_META: Record<DocumentListStatus, { label: string; color: ChipProps['color'] }> = {
  draft: { label: '草稿', color: 'default' },
  active: { label: '簽署中', color: 'warning' },
  expired: { label: '已到期', color: 'info' },
  finalizing: { label: '完成處理中', color: 'success' },
  completed: { label: '已完成', color: 'success' },
  stopped: { label: '已停止', color: 'error' },
};

/** 依流程先後排列（狀態篩選選項與排序共用） */
export const DOCUMENT_STATUSES: DocumentListStatus[] = ['draft', 'active', 'expired', 'finalizing', 'completed', 'stopped'];

export const DOCUMENT_STATUS_OPTIONS = DOCUMENT_STATUSES.map((s) => ({ value: s, label: DOCUMENT_STATUS_META[s].label }));

/** 簽署中但已超過簽署結束時間、仍有人未簽署時，顯示為已到期 */
export function documentStatus(doc: EsignDocumentListItem, now: Date = new Date()): DocumentListStatus {
  if (doc.status === 'active' && doc.pendingCount > 0 && doc.signEndAt && new Date(doc.signEndAt) < now) {
    return 'expired';
  }
  return doc.status;
}

/** ISO 時間轉成畫面日期 YYYY/MM/DD（本地時區） */
export const formatDate = (iso: string | null) => (iso ? dayjs(iso).format('YYYY/MM/DD') : null);

// ── 篩選 ──────────────────────────────────────────────

export type DocumentFilters = {
  query: string;
  /** 空陣列表示全部狀態 */
  statuses: DocumentListStatus[];
  /** YYYY-MM-DD；null 表示不限 */
  from: string | null;
  to: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateParam = (v: string | null) => (v && ISO_DATE.test(v) ? v : null);

export function parseDocumentFilters(params: URLSearchParams): DocumentFilters {
  const statuses = (params.get('status') ?? '').split(',');
  let from = dateParam(params.get('from'));
  let to = dateParam(params.get('to'));
  // 起日晚於迄日時對調，避免整個列表變空
  if (from && to && from > to) [from, to] = [to, from];
  return {
    query: (params.get('q') ?? '').trim(),
    statuses: DOCUMENT_STATUSES.filter((s) => statuses.includes(s)),
    from,
    to,
  };
}

export const hasDocumentFilters = (f: DocumentFilters) => !!(f.query || f.statuses.length || f.from || f.to);

const localDate = (iso: string) => dayjs(iso).format('YYYY-MM-DD');

/**
 * 篩選：
 * - 關鍵字：文件名稱、建立人姓名或員工編號包含關鍵字（不分大小寫）
 * - 狀態：符合任一勾選的狀態
 * - 簽署期間：與指定日期區間有重疊（未設結束時間視為不限）；尚未發起、沒有簽署期間的文件不會列出
 */
export function filterDocuments(docs: EsignDocumentListItem[], filters: DocumentFilters, now: Date = new Date()) {
  const q = filters.query.toLowerCase();
  return docs.filter((d) => {
    if (q && ![d.title, d.createdBy?.name ?? '', d.createdBy?.employeeNo ?? ''].some((v) => v.toLowerCase().includes(q))) {
      return false;
    }
    if (filters.statuses.length && !filters.statuses.includes(documentStatus(d, now))) return false;
    if (filters.from || filters.to) {
      if (!d.signStartAt) return false;
      if (filters.to && localDate(d.signStartAt) > filters.to) return false;
      if (filters.from && d.signEndAt && localDate(d.signEndAt) < filters.from) return false;
    }
    return true;
  });
}

// ── 排序 ──────────────────────────────────────────────

export const DOCUMENT_SORT_KEYS = ['name', 'docNumber', 'startAt', 'endAt', 'status', 'progress', 'createdBy'] as const;
export type DocumentSortKey = (typeof DOCUMENT_SORT_KEYS)[number];
export type DocumentSort = Sort<DocumentSortKey>;

const STATUS_ORDER = Object.fromEntries(DOCUMENT_STATUSES.map((s, i) => [s, i])) as Record<DocumentListStatus, number>;

/** 各欄的排序值；null 表示沒有值，不論升冪或降冪都排在最後 */
const sortValue = (key: DocumentSortKey, now: Date) => (d: EsignDocumentListItem): SortValue => {
  const total = d.signedCount + d.pendingCount;
  switch (key) {
    case 'name':
      return d.title;
    case 'docNumber':
      return d.docNumber || null;
    case 'startAt':
      return d.signStartAt;
    // 已發起但未設結束時間（不限）視為最晚；尚未發起才是無值
    case 'endAt':
      return d.signEndAt ?? (d.signStartAt ? '￿' : null);
    case 'status':
      return STATUS_ORDER[documentStatus(d, now)];
    // 依完成比例，再依已簽人數；沒有簽署人視為無值
    case 'progress':
      return total ? [d.signedCount / total, d.signedCount] : null;
    case 'createdBy':
      return d.createdBy ? `${d.createdBy.name}\u0000${d.createdBy.employeeNo}` : null;
  }
};

export function parseDocumentSort(params: URLSearchParams): DocumentSort {
  return parseSortParams(
    { sort: params.get('sort') ?? undefined, order: params.get('order') ?? undefined },
    DOCUMENT_SORT_KEYS,
  );
}

/** 未指定排序時維持後端的順序（更新時間由新到舊） */
export function sortDocuments(docs: EsignDocumentListItem[], sort: DocumentSort, now: Date = new Date()) {
  return sort ? sortByValue(docs, sortValue(sort.key, now), sort.order) : docs;
}

// ── 網址 ──────────────────────────────────────────────

/** 組出列表網址，保留搜尋、篩選與排序；未指定頁碼時回到第 1 頁 */
export function documentsHref(opts: { filters: DocumentFilters; sort: DocumentSort; page?: number }) {
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
