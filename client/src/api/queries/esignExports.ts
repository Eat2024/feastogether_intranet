import { queryKeys } from '@/api/query-keys';
import { queryOptions } from '@/api/query-options';
import { getAllExportHistory, getDocumentExport, getDocumentExportPreview, getExportHistory } from '@/api/requests';
import type { ExportHistoryPage, ExportHistoryParams, ExportHistoryType } from '@/api/types';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import type { AxiosError } from 'axios';

/** 歷史匯出紀錄（依類型、關鍵字、頁碼分頁；params 共同構成快取 key） */
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

/** 某類型的全部歷史匯出紀錄（前端排序用；params 共同構成快取 key，與分頁查詢共用前綴，重新下載後一併更新） */
export function useGetAllExportHistoryQuery<T extends ExportHistoryType>(
  params: Omit<ExportHistoryParams<T>, 'page' | 'pageSize'>,
  options?: Omit<UseQueryOptions<Awaited<ReturnType<typeof getAllExportHistory<T>>>, AxiosError>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: [queryKeys.ESIGN_EXPORT_HISTORY, 'all', params],
    queryFn: () => getAllExportHistory(params),
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

/** 匯出資料與一般文件詳情分開快取，每次進入重新驗證部門資格。 */
export function useGetDocumentExportPreviewQuery(id: string) {
  return useQuery({
    queryKey: [queryKeys.ESIGN_DOCUMENT_EXPORT_PREVIEW, id],
    queryFn: () => getDocumentExportPreview(id),
    ...queryOptions.useGetDocumentExportPreviewQuery,
  });
}
