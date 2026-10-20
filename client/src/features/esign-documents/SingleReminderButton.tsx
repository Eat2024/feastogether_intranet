'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createNotificationBatch } from '@/api/requests';
import { useGetNotificationBatchQuery } from '@/api/queries';
import { queryKeys } from '@/api/query-keys';
import type { EsignManagedSignerView } from '@/api/types';
import TooltipIconButton from '@/components/TooltipIconButton';
import { useSnackbar } from '@/components/providers/SnackbarProvider';
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded';
import Typography from '@mui/material/Typography';
import { notificationReasons, notificationStatuses } from './notificationLabels';

export default function SingleReminderButton({
  documentId,
  signer,
}: {
  documentId: string;
  signer: EsignManagedSignerView;
}) {
  const requestId = useRef<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const client = useQueryClient();
  const { showSnackbar } = useSnackbar();
  const batch = useGetNotificationBatchQuery(documentId, batchId);
  const refresh = () =>
    client.invalidateQueries({
      queryKey: [queryKeys.ESIGN_DOCUMENT, documentId],
    });
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
      void client.invalidateQueries({
        queryKey: [queryKeys.ESIGN_NOTIFICATION_BATCHES, documentId],
      });
      showSnackbar('已受理催簽，將由後端寄出通知信', 'success');
    },
    onError: () => {
      void refresh();
    },
  });
  const batchStatus = batch.data?.status;
  useEffect(() => {
    if (batchStatus && !['queued', 'processing'].includes(batchStatus))
      void client.invalidateQueries({
        queryKey: [queryKeys.ESIGN_DOCUMENT, documentId],
      });
  }, [batchStatus, client, documentId]);
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
              : (notificationReasons[reason ?? ''] ?? '目前不可催簽')
        }
        icon={<NotificationsActiveRoundedIcon />}
        color="info"
        disabled={!eligible || mutation.isPending}
        onClick={() => mutation.mutate()}
      />
      {result && (
        <Typography variant="helper" component="span">
          {notificationStatuses[result.status] ?? result.status}
        </Typography>
      )}
    </>
  );
}
