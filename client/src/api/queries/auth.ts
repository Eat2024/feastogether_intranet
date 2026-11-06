import { queryKeys } from '@/api/query-keys';
import { getSession } from '@/api/requests';
import { useQuery } from '@tanstack/react-query';

/** 目前身分（員工或其他身分）；會話失效的 401 照常交給全站登入過期提示 */
export function useGetSessionQuery() {
  return useQuery({
    queryKey: [queryKeys.AUTH_SESSION],
    queryFn: getSession,
  });
}
