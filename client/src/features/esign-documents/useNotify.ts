'use client';

// 建立催簽批次（POST /api/esign/documents/:id/notification-batches），單人通知與批次通知共用；內外部簽署人皆可催簽。
// 後端只受理、背景寄送；成功後更新文件詳情（通知紀錄、可否催簽）與通知歷史。
import { queryKeys } from '@/api/query-keys';
import { createNotificationBatch } from '@/api/requests';
import type { CreateNotificationBatchBody } from '@/api/types';
import { useSnackbar } from '@/components/providers/SnackbarProvider';
import { getErrorMessage } from '@/lib/apiError';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';

type Target = Pick<CreateNotificationBatchBody, 'selection' | 'signerPublicIds'>;

export function useNotify(documentId: string) {
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();
  // 同一組對象重送時沿用 requestId（後端依此判斷重複送出，不會重寄）；對象改變或成功後換新的
  const lastRequest = useRef<{ key: string; requestId: string } | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_DOCUMENT, documentId] });
    void queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_NOTIFICATION_BATCHES, documentId] });
  };

  return useMutation({
    mutationFn: ({ selection, signerPublicIds }: Target) => {
      const ids = signerPublicIds && [...signerPublicIds].sort();
      const key = JSON.stringify({ selection, ids });
      if (lastRequest.current?.key !== key) lastRequest.current = { key, requestId: crypto.randomUUID() };
      return createNotificationBatch({
        id: documentId,
        body: { requestId: lastRequest.current.requestId, selection, signerPublicIds: ids },
      });
    },
    // 錯誤以後端訊息顯示（例如沒有可催簽的對象）
    meta: { suppressGlobalErrorToast: true },
    onSuccess: (batch) => {
      lastRequest.current = null;
      refresh();
      showSnackbar(
        batch.notSentCount
          ? `已受理 ${batch.queuedCount} 人催簽，${batch.notSentCount} 人不符合條件未寄出；寄送結果可在通知紀錄查看`
          : `已受理 ${batch.queuedCount} 人催簽，將由系統寄出通知信`,
        'success',
      );
    },
    onError: (err) => {
      // 畫面上的可否催簽可能已過時：重新取得最新狀態
      refresh();
      showSnackbar(getErrorMessage(err, '催簽失敗，請稍後再試'), 'error');
    },
  });
}
