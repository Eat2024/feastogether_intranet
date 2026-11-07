import type { QueryKey } from '@tanstack/react-query';

export const isAuthorizationQueryKey = (queryKey: QueryKey): boolean =>
  queryKey[0] === 'AUTH_ME';

export const isInternalBusinessQueryKey = (queryKey: QueryKey): boolean =>
  typeof queryKey[0] === 'string' && queryKey[0].startsWith('ESIGN_');

export const isInternalIdentityQueryKey = (queryKey: QueryKey): boolean =>
  isAuthorizationQueryKey(queryKey) || isInternalBusinessQueryKey(queryKey);

export function shouldRevalidateAuthorization(input: {
  status?: number;
  code?: string;
  url?: string;
  failedQueryKey?: QueryKey;
}): boolean {
  const url = input.url?.replace(/^\//u, '') ?? '';
  return input.status === 403 && input.code === 'AUTHORIZATION_DENIED' &&
    url.startsWith('esign/') &&
    (!input.failedQueryKey || !isAuthorizationQueryKey(input.failedQueryKey));
}

/** 同一時間只執行一個工作；完成後下一次仍可重新執行。 */
export class SingleFlight {
  private pending: Promise<void> | null = null;

  run(task: () => Promise<void>): Promise<void> {
    if (this.pending) return this.pending;
    this.pending = task().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
}
