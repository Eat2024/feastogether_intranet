'use client';

// TanStack Query 的 QueryClient；query 與 mutation 失敗時統一以 Snackbar 顯示錯誤，
// 收到 401（登入已過期）時改以整頁提示請使用者重新進入；外部簽署存取失效由外部簽署頁自行顯示。
import { UNAUTHORIZED_REDIRECT } from '@/api/config';
import { getErrorMessage, isExternalAccessLost } from '@/lib/apiError';
import { minutes } from '@/lib/time';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import axios from 'axios';
import { useState, type ReactNode } from 'react';
import SessionExpiredDialog from './SessionExpiredDialog';
import { useSnackbar } from './SnackbarProvider';

// 個別 mutation 可宣告 meta.suppressGlobalErrorToast，自行處理錯誤顯示（避免全域與元件各跳一次）
declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: { suppressGlobalErrorToast?: boolean };
  }
}

/** 401 且已設定登入頁時由 axios interceptor 導頁，這裡不再重複提示 */
const isRedirectingUnauthorized = (error: unknown) =>
  !!UNAUTHORIZED_REDIRECT && axios.isAxiosError(error) && error.response?.status === 401;

const isUnauthorized = (error: unknown) => axios.isAxiosError(error) && error.response?.status === 401;

export default function ReactQueryProvider({ children }: { children: ReactNode }) {
  const { showSnackbar } = useSnackbar();
  const [sessionExpired, setSessionExpired] = useState(false);
  /** 401：不跳個別錯誤，改顯示整頁的登入過期提示；其他錯誤照常以 Snackbar 顯示 */
  const handleError = (error: unknown, suppressToast = false) => {
    // 外部簽署人沒有員工登入：存取失效由外部簽署頁顯示失效卡片
    if (isRedirectingUnauthorized(error) || isExternalAccessLost(error)) return;
    if (isUnauthorized(error)) return setSessionExpired(true);
    if (!suppressToast) showSnackbar(getErrorMessage(error), 'error');
  };

  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError(error) {
            handleError(error);
          },
        }),
        mutationCache: new MutationCache({
          onError(error, _variables, _context, mutation) {
            handleError(error, mutation.meta?.suppressGlobalErrorToast);
          },
        }),
        defaultOptions: {
          queries: {
            staleTime: minutes(5),
            gcTime: minutes(30),
            refetchOnWindowFocus: false,
            retry: 0,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <SessionExpiredDialog open={sessionExpired} />
      {process.env.NODE_ENV === 'development' && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
