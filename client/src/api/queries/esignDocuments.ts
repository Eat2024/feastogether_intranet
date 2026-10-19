import { queryKeys } from '@/api/query-keys';
import { queryOptions } from '@/api/query-options';
import { getDocument, getDocuments } from '@/api/requests';
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
