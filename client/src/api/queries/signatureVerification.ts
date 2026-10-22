import { queryKeys } from '@/api/query-keys';
import { queryOptions } from '@/api/query-options';
import { getSignatureVerification } from '@/api/requests';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import type { AxiosError } from 'axios';

/** 公開簽章驗證；錯誤（查無、驗證失敗）由驗證頁自行顯示 */
export function useGetSignatureVerificationQuery<
  TData = Awaited<ReturnType<typeof getSignatureVerification>>,
  TError = AxiosError,
>(
  code: string,
  options?: Omit<
    UseQueryOptions<Awaited<ReturnType<typeof getSignatureVerification>>, TError, TData>,
    'queryKey' | 'queryFn'
  >,
) {
  return useQuery({
    queryKey: [queryKeys.SIGNATURE_VERIFICATION, code],
    queryFn: () => getSignatureVerification(code),
    meta: { suppressGlobalErrorToast: true },
    ...queryOptions.useGetSignatureVerificationQuery,
    ...options,
  });
}
