import { queryKeys } from '@/api/query-keys';
import { queryOptions } from '@/api/query-options';
import { getMe } from '@/api/requests';
import { useQuery } from '@tanstack/react-query';

/** 目前登入者與有效能力；每次聚焦、掛載或切換內部路由都重新驗證。 */
export function useGetMeQuery(pathname: string) {
  return useQuery({
    queryKey: [queryKeys.AUTH_ME, pathname],
    queryFn: ({ signal }) => getMe(signal),
    ...queryOptions.useGetMeQuery,
    meta: { suppressGlobalErrorToast: true },
  });
}
