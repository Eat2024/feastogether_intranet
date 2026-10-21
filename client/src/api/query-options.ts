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
  // 催簽由後端背景寄送，結果會陸續更新
  useGetNotificationBatchesQuery: {
    staleTime: 0,
    gcTime: minutes(5),
  },
  useGetNotificationBatchQuery: {
    staleTime: 0,
    gcTime: minutes(5),
  },
  // 匯出由後端背景處理，進度會陸續更新
  useGetExportHistoryQuery: {
    staleTime: 0,
    gcTime: minutes(5),
  },
  useGetDocumentExportQuery: {
    staleTime: 0,
    gcTime: minutes(5),
  },
  // 組織架構後端已快取 2 小時；同一次操作中切換頁面不需重新讀取
  useGetSignerOrgChartQuery: {
    staleTime: minutes(10),
    gcTime: minutes(10),
  },
  // 邀請連結即憑證：不保留在快取中，每次開啟都重新取得
  useGetReopeningInvitationsQuery: {
    staleTime: 0,
    gcTime: 0,
  },
  // 簽署頁也從列表找出任務，是否仍可簽署須以最新資料為準
  useGetSigningTasksQuery: {
    staleTime: 0,
    gcTime: minutes(5),
  },
};
