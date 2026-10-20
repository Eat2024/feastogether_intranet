'use client';

// 列表操作欄的「刪除」：只有草稿可以刪除，呼叫 DELETE /api/esign/documents/:id
import { queryKeys } from '@/api/query-keys';
import { deleteDocument } from '@/api/requests';
import type { EsignDocumentListItem } from '@/api/types';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useSnackbar } from '@/components/providers/SnackbarProvider';
import TooltipIconButton from '@/components/TooltipIconButton';
import { getErrorMessage } from '@/lib/apiError';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded';
import Alert from '@mui/material/Alert';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

export default function DeleteDocumentButton({
  doc,
  disabled,
}: {
  doc: Pick<EsignDocumentListItem, 'id' | 'title'>;
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();
  const [open, setOpen] = useState(false);
  const remove = useMutation({
    mutationFn: deleteDocument,
    // 錯誤顯示在 dialog 內
    meta: { suppressGlobalErrorToast: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_DOCUMENTS] });
      queryClient.removeQueries({ queryKey: [queryKeys.ESIGN_DOCUMENT, doc.id] });
      setOpen(false);
      showSnackbar(`已刪除「${doc.title}」`, 'success');
    },
  });

  return (
    <>
      <TooltipIconButton
        label="刪除"
        icon={<DeleteOutlineRoundedIcon />}
        color="error"
        disabled={disabled}
        onClick={() => {
          remove.reset();
          setOpen(true);
        }}
      />
      <ConfirmDialog
        open={open}
        color="error"
        icon={<DeleteRoundedIcon />}
        title="刪除此文件？"
        description={`「${doc.title}」尚未發起簽署，刪除後將從列表移除且無法復原。`}
        confirmLabel="刪除"
        loading={remove.isPending}
        onConfirm={() => remove.mutate(doc.id)}
        onClose={() => setOpen(false)}
      >
        {remove.isError && <Alert severity="error">{getErrorMessage(remove.error, '刪除失敗，請稍後再試')}</Alert>}
      </ConfirmDialog>
    </>
  );
}
