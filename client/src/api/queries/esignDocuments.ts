import { getNotificationBatch } from '../requests/esignDocuments';
import { queryKeys } from '@/api/query-keys';
import { queryOptions } from '@/api/query-options';
import { getDocument, getDocumentHistory, getDocuments } from '@/api/requests';
import type { GetDocumentsParams } from '@/api/types';
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

export function useGetNotificationBatchQuery(id: string,batchId: string | null) {
  return useQuery({queryKey:[queryKeys.ESIGN_NOTIFICATION_BATCH,id,batchId],queryFn:()=>getNotificationBatch(id,batchId!),enabled:batchId !== null,...queryOptions.useGetNotificationBatchQuery,refetchInterval:(query)=>query.state.data?.status === 'completed' ? false : 2000});
}
