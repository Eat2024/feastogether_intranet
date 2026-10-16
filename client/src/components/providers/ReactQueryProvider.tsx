'use client';

// TanStack Query 的 QueryClient；query 與 mutation 失敗時統一以 Snackbar 顯示錯誤。
import { UNAUTHORIZED_REDIRECT } from '@/api/config';
import { getErrorMessage } from '@/lib/apiError';
import { minutes } from '@/lib/time';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import axios from 'axios';
import { useState, type ReactNode } from 'react';
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

export default function ReactQueryProvider({ children }: { children: ReactNode }) {
  const { showSnackbar } = useSnackbar();

  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError(error) {
            if (isRedirectingUnauthorized(error)) return;
            showSnackbar(getErrorMessage(error), 'error');
          },
        }),
        mutationCache: new MutationCache({
          onError(error, _variables, _context, mutation) {
            if (isRedirectingUnauthorized(error)) return;
            if (mutation.meta?.suppressGlobalErrorToast) return;
            showSnackbar(getErrorMessage(error), 'error');
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
      {process.env.NODE_ENV === 'development' && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
