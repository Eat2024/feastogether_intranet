'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import TextField from '@mui/material/TextField';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import ConfirmDialog from '@/components/ConfirmDialog';
import TooltipIconButton from '@/components/TooltipIconButton';
import { useSnackbar } from '@/components/providers/SnackbarProvider';
import { queryKeys } from '@/api/query-keys';
import { getErrorMessage } from '@/lib/apiError';

/** 重新下載不覆寫既有檔名快照；失敗保留輸入，重新開啟則重設。 */
export default function HistoryDownloadButton({ label, extension, onDownload }: {
  label: string;
  extension: 'xlsx' | 'pdf' | 'zip';
  onDownload: (fileName: string) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState('');
  const { showSnackbar } = useSnackbar();
  const download = useMutation({
    mutationFn: onDownload,
    meta: { suppressGlobalErrorToast: true },
    onSuccess: () => {
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_EXPORT_HISTORY] });
    },
    onError: (err) => showSnackbar(getErrorMessage(err, '下載失敗，請稍後再試'), 'error'),
  });

  return (
    <>
      <TooltipIconButton
        label={label}
        icon={<FileDownloadRoundedIcon />}
        color="info"
        disabled={download.isPending}
        onClick={() => { setFileName(''); setOpen(true); }}
      />
      <ConfirmDialog
        open={open}
        title="下載檔案"
        confirmLabel="下載"
        loading={download.isPending}
        onConfirm={() => download.mutate(fileName)}
        onClose={() => setOpen(false)}
      >
        <TextField
          autoFocus
          fullWidth
          label="檔案名稱"
          value={fileName}
          disabled={download.isPending}
          onChange={(event) => setFileName(event.target.value)}
          placeholder="未填寫時使用系統預設檔名"
          helperText={`僅套用本次下載，自動處理 .${extension} 副檔名；最多 100 字，留白使用預設檔名。`}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && !download.isPending) {
              event.preventDefault();
              download.mutate(fileName);
            }
          }}
        />
      </ConfirmDialog>
    </>
  );
}
