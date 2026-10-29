import { queryKeys } from '@/api/query-keys';
import { queryOptions } from '@/api/query-options';
import { getDocumentExport, getExportHistory } from '@/api/requests';
import type { ExportHistoryPage, ExportHistoryParams, ExportHistoryType } from '@/api/types';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import type { AxiosError } from 'axios';

/** 歷史匯出紀錄（依類型、頁碼分頁） */
export function useGetExportHistoryQuery<T extends ExportHistoryType>(
  params: ExportHistoryParams<T>,
  options?: Omit<UseQueryOptions<ExportHistoryPage<T>, AxiosError>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: [queryKeys.ESIGN_EXPORT_HISTORY, params],
    queryFn: () => getExportHistory(params),
    ...queryOptions.useGetExportHistoryQuery,
    ...options,
  });
}

/** 匯出工作的進度；exportId 為 null 時不查詢。處理中（排隊、等待副本、打包）每 3 秒更新一次，在背景也會更新 */
export function useGetDocumentExportQuery<TData = Awaited<ReturnType<typeof getDocumentExport>>, TError = AxiosError>(
  id: string,
  exportId: string | null,
  options?: Omit<UseQueryOptions<Awaited<ReturnType<typeof getDocumentExport>>, TError, TData>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: [queryKeys.ESIGN_DOCUMENT_EXPORT, id, exportId],
    queryFn: () => getDocumentExport(id, exportId!),
    enabled: exportId !== null,
    refetchInterval: (query) =>
      query.state.data && ['pending', 'waiting', 'processing'].includes(query.state.data.status) ? 3000 : false,
    // 切到其他分頁時也繼續更新，回來時就是最新進度（只在處理中才會輪詢）
    refetchIntervalInBackground: true,
    ...queryOptions.useGetDocumentExportQuery,
    ...options,
  });
}
