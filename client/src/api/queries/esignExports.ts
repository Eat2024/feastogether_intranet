import { useQuery } from '@tanstack/react-query';
import { getExportableDocuments, getExports } from '@/api/requests';
import { queryKeys } from '@/api/query-keys';
import { queryOptions } from '@/api/query-options';
import type { ExportListParams } from '@/api/types';
export function useGetExportableDocumentsQuery(params: ExportListParams) {
  return useQuery({ queryKey: [queryKeys.ESIGN_EXPORTABLE_DOCUMENTS, params], queryFn: () => getExportableDocuments(params), ...queryOptions.useGetExportsQuery });
}
export function useGetExportsQuery(params: ExportListParams) {
  return useQuery({ queryKey: [queryKeys.ESIGN_EXPORTS, params], queryFn: () => getExports(params), ...queryOptions.useGetExportsQuery,
    refetchInterval: query => query.state.data?.items.some(job => ['pending', 'waiting', 'processing'].includes(job.status)) ? 3000 : false });
}
