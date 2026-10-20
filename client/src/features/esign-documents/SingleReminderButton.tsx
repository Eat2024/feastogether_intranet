'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createNotificationBatch } from '@/api/requests';
import { useGetNotificationBatchQuery } from '@/api/queries';
import { queryKeys } from '@/api/query-keys';
import type { EsignSignerView } from '@/api/types';
import TooltipIconButton from '@/components/TooltipIconButton';
import { useSnackbar } from '@/components/providers/SnackbarProvider';
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded';
import Typography from '@mui/material/Typography';

const reasons: Record<string, string> = {
  INTERNAL_NOT_SUPPORTED: '目前只支援外部簽署人催簽',
  SIGNER_NOT_PENDING: '已簽署或拒簽，不需催簽',
  DOCUMENT_NOT_SIGNABLE: '目前不在有效簽署期間',
  IN_FLIGHT: '催簽排隊或寄送中',
  DAILY_LIMIT: '今天已催簽，台北時間午夜後可再通知',
};
const statuses: Record<string, string> = {
  pending: '催簽排隊中',
  processing: '催簽寄送中',
  delivered: '催簽信已寄出',
  failed: '催簽寄送失敗',
  skipped: '催簽未寄出',
  unknown: '催簽結果未確認，不自動重寄',
};

export default function SingleReminderButton({ documentId, signer }: { documentId: string; signer: EsignSignerView }) {
  const requestId = useRef<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const client = useQueryClient();
  const { showSnackbar } = useSnackbar();
  const batch = useGetNotificationBatchQuery(documentId, batchId);
  const refresh = () => client.invalidateQueries({ queryKey: [queryKeys.ESIGN_DOCUMENT, documentId] });
  const mutation = useMutation({
    mutationFn: () => {
      requestId.current ??= crypto.randomUUID();
      return createNotificationBatch(documentId, {
        requestId: requestId.current,
        selection: 'selected',
        signerPublicIds: [signer.publicId],
      });
    },
    onSuccess: (result) => {
      requestId.current = null;
      setBatchId(result.batchId);
      void refresh();
      showSnackbar('已受理催簽，將由後端寄出通知信', 'success');
    },
    onError: () => {
      void refresh();
    },
  });
  useEffect(() => {
    if (batch.data?.status === 'completed')
      void client.invalidateQueries({ queryKey: [queryKeys.ESIGN_DOCUMENT, documentId] });
  }, [batch.data?.status, client, documentId]);
  const eligible = signer.reminderEligibility?.eligible === true;
  const result = batch.data?.items.find((item) => item.signerPublicId === signer.publicId) ?? signer.latestReminder;
  const reason = signer.reminderEligibility?.reasonCode;
  return (
    <>
      <TooltipIconButton
        label={
          mutation.isPending
            ? '正在申請催簽…'
            : eligible
              ? '寄送外部催簽通知（每日一次）'
              : (reasons[reason ?? ''] ?? '目前不可催簽')
        }
        icon={<NotificationsActiveRoundedIcon />}
        color="info"
        disabled={!eligible || mutation.isPending}
        onClick={() => mutation.mutate()}
      />
      {result && (
        <Typography variant="helper" component="span">
          {statuses[result.status] ?? result.status}
        </Typography>
      )}
    </>
  );
}
