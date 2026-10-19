'use client';

// 列表操作欄的「停止簽署」：填寫原因後呼叫 POST /api/esign/documents/:id/stoppages
import { queryKeys } from '@/api/query-keys';
import { stopDocument } from '@/api/requests';
import type { EsignDocumentListItem } from '@/api/types';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useSnackbar } from '@/components/providers/SnackbarProvider';
import TooltipIconButton from '@/components/TooltipIconButton';
import { getErrorMessage } from '@/lib/apiError';
import DoDisturbIcon from '@mui/icons-material/DoDisturb';
import Alert from '@mui/material/Alert';
import TextField from '@mui/material/TextField';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

// 後端限制（server/src/features/esign/dto/stoppage.dto.ts）
const MAX_REASON = 500;

export default function StopDocumentButton({
  doc,
  disabled,
}: {
  doc: Pick<EsignDocumentListItem, 'id' | 'title' | 'pendingCount'>;
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const stop = useMutation({
    mutationFn: stopDocument,
    // 錯誤顯示在 dialog 內
    meta: { suppressGlobalErrorToast: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_DOCUMENTS] });
      void queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_DOCUMENT, doc.id] });
      setOpen(false);
      showSnackbar(`已停止「${doc.title}」的簽署`, 'success');
    },
  });

  const trimmed = reason.trim();
  const reasonError = touched && !trimmed ? '請填寫停止原因' : undefined;

  const openDialog = () => {
    setReason('');
    setTouched(false);
    stop.reset();
    setOpen(true);
  };

  const confirm = () => {
    setTouched(true);
    if (!trimmed) return;
    stop.mutate({ id: doc.id, reason: trimmed });
  };

  return (
    <>
      <TooltipIconButton label="停止簽署" icon={<DoDisturbIcon />} color="error" disabled={disabled} onClick={openDialog} />
      <ConfirmDialog
        open={open}
        color="error"
        icon={<DoDisturbIcon />}
        title="停止此文件的簽署？"
        description={`「${doc.title}」停止後將無法再收到新的簽署${doc.pendingCount ? `，尚未簽署的 ${doc.pendingCount} 人將無法再簽署此文件` : ''}。`}
        confirmLabel="停止簽署"
        loading={stop.isPending}
        onConfirm={confirm}
        onClose={() => setOpen(false)}
      >
        <TextField
          fullWidth
          multiline
          minRows={3}
          label="停止原因"
          placeholder="例如：文件內容有誤，將重新發起"
          value={reason}
          disabled={stop.isPending}
          onChange={(e) => setReason(e.target.value.slice(0, MAX_REASON))}
          onBlur={() => setTouched(true)}
          error={!!reasonError}
          helperText={reasonError ?? `${reason.length}/${MAX_REASON}；停止原因會保留在文件紀錄中`}
        />
        {stop.isError && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {getErrorMessage(stop.error, '停止簽署失敗，請稍後再試')}
          </Alert>
        )}
      </ConfirmDialog>
    </>
  );
}
