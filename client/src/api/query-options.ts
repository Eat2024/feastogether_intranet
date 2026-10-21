import { minutes } from '@/lib/time';

/** 各 query hook 的快取設定；未列出的 hook 使用 ReactQueryProvider 的預設值。 */
export const queryOptions: Record<
  string,
  Partial<{ staleTime: number; gcTime: number; refetchOnWindowFocus: boolean; retry: number; retryDelay: number }>
> = {
  // 文件狀態會隨簽署進度變動，快取放短一點
  useGetDocumentsQuery: {
    staleTime: minutes(1),
    gcTime: minutes(5),
  },
  // 設定簽署時讀取草稿；每次進入頁面都以最新資料為準
  useGetDocumentQuery: {
    staleTime: 0,
    gcTime: minutes(5),
  },
  useGetDocumentHistoryQuery: {
    staleTime: 0,
    gcTime: minutes(5),
  },
};
