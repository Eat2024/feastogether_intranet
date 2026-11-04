'use client';

import { useMutation } from '@tanstack/react-query';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import TooltipIconButton from '@/components/TooltipIconButton';
import { useSnackbar } from '@/components/providers/SnackbarProvider';
import { getErrorMessage } from '@/lib/apiError';

/** 歷史重新下載：直接以紀錄的匯出檔名下載，不再詢問檔名。 */
export default function HistoryDownloadButton({ label, onDownload }: {
  label: string;
  onDownload: () => Promise<void>;
}) {
  const { showSnackbar } = useSnackbar();
  const download = useMutation({
    mutationFn: onDownload,
    meta: { suppressGlobalErrorToast: true },
    onError: (err) => showSnackbar(getErrorMessage(err, '下載失敗，請稍後再試'), 'error'),
  });

  return (
    <TooltipIconButton
      label={label}
      icon={<FileDownloadRoundedIcon />}
      color="info"
      disabled={download.isPending}
      onClick={() => download.mutate()}
    />
  );
}
