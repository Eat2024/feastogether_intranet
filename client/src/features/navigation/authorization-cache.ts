import { queryKeys } from '@/api/query-keys';
import { getErrorCode } from '@/lib/apiError';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import axios from 'axios';
import {
  isInternalBusinessQueryKey,
  isInternalIdentityQueryKey,
  shouldRevalidateAuthorization,
  SingleFlight,
} from './authorization-cache-policy';

export async function clearInternalIdentityCache(queryClient: QueryClient): Promise<void> {
  await queryClient.cancelQueries({ predicate: (query) => isInternalIdentityQueryKey(query.queryKey) });
  queryClient.removeQueries({ predicate: (query) => isInternalIdentityQueryKey(query.queryKey) });
}

/** 已取得新 actor 快照時保留該 auth/me，只移除上一個 actor 的內部業務資料。 */
export async function clearInternalBusinessCache(queryClient: QueryClient): Promise<void> {
  await queryClient.cancelQueries({ predicate: (query) => isInternalBusinessQueryKey(query.queryKey) });
  queryClient.removeQueries({ predicate: (query) => isInternalBusinessQueryKey(query.queryKey) });
}

export async function clearAuthorizationCache(queryClient: QueryClient): Promise<void> {
  await queryClient.cancelQueries({ queryKey: [queryKeys.AUTH_ME] });
  queryClient.removeQueries({ queryKey: [queryKeys.AUTH_ME] });
}

const authorizationRefresh = new SingleFlight();

/** 合併同時發生的內部業務 403；只重驗能力，不重送被拒的業務請求。 */
export function revalidateAuthorizationAfterDenied(
  queryClient: QueryClient,
  error: unknown,
  failedQueryKey?: QueryKey,
): void {
  if (!axios.isAxiosError(error) || !shouldRevalidateAuthorization({
    status: error.response?.status,
    code: getErrorCode(error),
    url: error.config?.url,
    failedQueryKey,
  })) return;
  void authorizationRefresh.run(async () => {
    await queryClient.cancelQueries({ queryKey: [queryKeys.AUTH_ME] });
    await queryClient.invalidateQueries({ queryKey: [queryKeys.AUTH_ME], refetchType: 'active' });
  });
}
