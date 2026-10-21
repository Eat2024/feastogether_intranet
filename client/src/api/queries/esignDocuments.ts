import { queryKeys } from '@/api/query-keys';
import { queryOptions } from '@/api/query-options';
import {
  getDocument,
  getDocumentHistory,
  getDocuments,
  getNotificationBatch,
  getNotificationBatches,
  getReopeningInvitations,
} from '@/api/requests';
import type { GetDocumentsParams, NotificationListParams, NotificationPageParams } from '@/api/types';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import type { AxiosError } from 'axios';

/** 電子簽文件列表 */
export function useGetDocumentsQuery<TData = Awaited<ReturnType<typeof getDocuments>>, TError = AxiosError>(
  params: GetDocumentsParams = {},
  options?: Omit<UseQueryOptions<Awaited<ReturnType<typeof getDocuments>>, TError, TData>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: [queryKeys.ESIGN_DOCUMENTS, params],
    queryFn: () => getDocuments(params),
    ...queryOptions.useGetDocumentsQuery,
    ...options,
  });
}

/** 建立人的文件詳情；id 為 null 時不查詢 */
export function useGetDocumentQuery<TData = Awaited<ReturnType<typeof getDocument>>, TError = AxiosError>(
  id: string | null,
  options?: Omit<UseQueryOptions<Awaited<ReturnType<typeof getDocument>>, TError, TData>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: [queryKeys.ESIGN_DOCUMENT, id],
    queryFn: () => getDocument(id!),
    enabled: id !== null,
    ...queryOptions.useGetDocumentQuery,
    ...options,
  });
}

/** 文件簽署歷程；id 為 null 時不查詢 */
export function useGetDocumentHistoryQuery<
  TData = Awaited<ReturnType<typeof getDocumentHistory>>,
  TError = AxiosError,
>(
  id: string | null,
  options?: Omit<UseQueryOptions<Awaited<ReturnType<typeof getDocumentHistory>>, TError, TData>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: [queryKeys.ESIGN_DOCUMENT_HISTORY, id],
    queryFn: () => getDocumentHistory(id!),
    enabled: id !== null,
    ...queryOptions.useGetDocumentHistoryQuery,
    ...options,
  });
}

/** 文件的通知批次（初次邀請與催簽） */
export function useGetNotificationBatchesQuery<
  TData = Awaited<ReturnType<typeof getNotificationBatches>>,
  TError = AxiosError,
>(
  id: string,
  params: NotificationListParams = {},
  options?: Omit<UseQueryOptions<Awaited<ReturnType<typeof getNotificationBatches>>, TError, TData>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: [queryKeys.ESIGN_NOTIFICATION_BATCHES, id, params],
    queryFn: () => getNotificationBatches(id, params),
    ...queryOptions.useGetNotificationBatchesQuery,
    ...options,
  });
}

/** 通知批次的逐人結果；batchId 為 null 時不查詢。寄送中（排隊、處理中）每 5 秒更新一次 */
export function useGetNotificationBatchQuery<
  TData = Awaited<ReturnType<typeof getNotificationBatch>>,
  TError = AxiosError,
>(
  id: string,
  batchId: string | null,
  params: NotificationPageParams = {},
  options?: Omit<UseQueryOptions<Awaited<ReturnType<typeof getNotificationBatch>>, TError, TData>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: [queryKeys.ESIGN_NOTIFICATION_BATCH, id, batchId, params],
    queryFn: () => getNotificationBatch(id, batchId!, params),
    enabled: batchId !== null,
    refetchInterval: (query) =>
      query.state.data && ['queued', 'processing'].includes(query.state.data.status) ? 5000 : false,
    ...queryOptions.useGetNotificationBatchQuery,
    ...options,
  });
}

/** 補簽的外部邀請連結；id 為 null 時不查詢（只在建立人開啟時讀取） */
export function useGetReopeningInvitationsQuery<
  TData = Awaited<ReturnType<typeof getReopeningInvitations>>,
  TError = AxiosError,
>(
  id: string | null,
  options?: Omit<UseQueryOptions<Awaited<ReturnType<typeof getReopeningInvitations>>, TError, TData>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: [queryKeys.ESIGN_REOPENING_INVITATIONS, id],
    queryFn: () => getReopeningInvitations(id!),
    enabled: id !== null,
    ...queryOptions.useGetReopeningInvitationsQuery,
    ...options,
  });
}
