import type { EsignDocumentListItem, EsignInitiationJob } from '@/api/types';

/** 受理回應只補入仍在準備的文件，不覆蓋較新的正式狀態。 */
export function withAcceptedInitiation(
  item: EsignDocumentListItem,
  documentId: string,
  status: EsignInitiationJob['status'],
  initiation: NonNullable<EsignDocumentListItem['initiation']>,
): EsignDocumentListItem {
  return item.id === documentId
    && (item.status === 'draft' || item.status === 'initiating')
    && (status === 'queued' || status === 'processing')
    ? { ...item, status: 'initiating', initiation }
    : item;
}
