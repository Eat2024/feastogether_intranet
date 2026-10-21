import { queryKeys } from '@/api/query-keys';
import { getExternalSigningTask } from '@/api/requests';
import { seconds } from '@/lib/time';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import type { AxiosError } from 'axios';

/** 本人副本產生中時重新查詢的間隔 */
const COPY_POLL_INTERVAL = seconds(3);

/**
 * 外部簽署任務（唯讀 GET，不記錄開啟）。
 * 本人副本產生中（pending／processing）時每 3 秒重新查詢；可下載、產製失敗或查詢失敗即停止。
 */
export function useGetExternalSigningTaskQuery<
  TData = Awaited<ReturnType<typeof getExternalSigningTask>>,
  TError = AxiosError,
>(
  options?: Omit<
    UseQueryOptions<Awaited<ReturnType<typeof getExternalSigningTask>>, TError, TData>,
    'queryKey' | 'queryFn' | 'refetchInterval'
  >,
) {
  return useQuery({
    queryKey: [queryKeys.EXTERNAL_SIGNING_TASK],
    queryFn: getExternalSigningTask,
    refetchInterval: (query) => {
      // 查詢失敗時停止，避免每 3 秒重複跳出錯誤訊息
      if (query.state.error) return false;
      const status = query.state.data?.signer.completion.status;
      return status === 'pending' || status === 'processing' ? COPY_POLL_INTERVAL : false;
    },
    ...options,
  });
}
