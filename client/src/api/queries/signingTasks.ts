import { queryKeys } from '@/api/query-keys';
import { queryOptions } from '@/api/query-options';
import { getSigningTasks } from '@/api/requests';
import type { GetSigningTasksParams } from '@/api/types';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import type { AxiosError } from 'axios';

/** 本人的簽署任務 */
export function useGetSigningTasksQuery<TData = Awaited<ReturnType<typeof getSigningTasks>>, TError = AxiosError>(
  params: GetSigningTasksParams = {},
  options?: Omit<UseQueryOptions<Awaited<ReturnType<typeof getSigningTasks>>, TError, TData>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: [queryKeys.ESIGN_SIGNING_TASKS, params],
    queryFn: () => getSigningTasks(params),
    ...queryOptions.useGetSigningTasksQuery,
    ...options,
  });
}
