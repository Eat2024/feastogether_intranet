import { queryKeys } from '@/api/query-keys';
import { queryOptions } from '@/api/query-options';
import { getDocuments } from '@/api/requests';
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
