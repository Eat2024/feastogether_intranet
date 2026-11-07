import { queryKeys } from '@/api/query-keys';
import { getErrorCode } from '@/lib/apiError';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import axios from 'axios';

const isInternalIdentityQuery = (queryKey: QueryKey): boolean => {
  const key = queryKey[0];
  return key === queryKeys.AUTH_ME || (typeof key === 'string' && key.startsWith('ESIGN_'));
};

const isInternalBusinessQuery = (queryKey: QueryKey): boolean => {
  const key = queryKey[0];
  return typeof key === 'string' && key.startsWith('ESIGN_');
};

export async function clearInternalIdentityCache(queryClient: QueryClient): Promise<void> {
  await queryClient.cancelQueries({ predicate: (query) => isInternalIdentityQuery(query.queryKey) });
  queryClient.removeQueries({ predicate: (query) => isInternalIdentityQuery(query.queryKey) });
}

/** 已取得新 actor 快照時保留該 auth/me，只移除上一個 actor 的內部業務資料。 */
export async function clearInternalBusinessCache(queryClient: QueryClient): Promise<void> {
  await queryClient.cancelQueries({ predicate: (query) => isInternalBusinessQuery(query.queryKey) });
  queryClient.removeQueries({ predicate: (query) => isInternalBusinessQuery(query.queryKey) });
}

export async function clearAuthorizationCache(queryClient: QueryClient): Promise<void> {
  await queryClient.cancelQueries({ queryKey: [queryKeys.AUTH_ME] });
  queryClient.removeQueries({ queryKey: [queryKeys.AUTH_ME] });
}

const isInternalBusinessAuthorizationDenied = (error: unknown): boolean => {
  if (!axios.isAxiosError(error) || error.response?.status !== 403) return false;
  if (getErrorCode(error) !== 'AUTHORIZATION_DENIED') return false;
  const url = error.config?.url?.replace(/^\//, '') ?? '';
  return url.startsWith('esign/');
};

let authorizationRefresh: Promise<void> | null = null;

/** 合併同時發生的內部業務 403；只重驗能力，不重送被拒的業務請求。 */
export function revalidateAuthorizationAfterDenied(
  queryClient: QueryClient,
  error: unknown,
  failedQueryKey?: QueryKey,
): void {
  if (!isInternalBusinessAuthorizationDenied(error) || failedQueryKey?.[0] === queryKeys.AUTH_ME) return;
  if (authorizationRefresh) return;
  authorizationRefresh = (async () => {
    await queryClient.cancelQueries({ queryKey: [queryKeys.AUTH_ME] });
    await queryClient.invalidateQueries({ queryKey: [queryKeys.AUTH_ME], refetchType: 'active' });
  })().finally(() => {
    authorizationRefresh = null;
  });
}
