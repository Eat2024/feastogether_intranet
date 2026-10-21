'use client';

// 下載本人的已簽署文件：GET /api/esign/signing-tasks/:signerPublicId/completed-file。
// 個人簽署副本由後端在簽署後產製，完成前按鈕停用並說明原因。
import { downloadMyCompletedFile } from '@/api/requests';
import type { EsignSigningTask } from '@/api/types';
import { useSnackbar } from '@/components/providers/SnackbarProvider';
import TooltipIconButton from '@/components/TooltipIconButton';
import { getErrorMessage } from '@/lib/apiError';
import { saveBlob } from '@/lib/saveBlob';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import { useMutation } from '@tanstack/react-query';

/** 個人副本尚未可下載的原因；可以下載時為 null */
function notReadyReason(completion: EsignSigningTask['signer']['completion']): string | null {
  switch (completion.status) {
    case 'ready':
      return null;
    case 'failed':
      return '已簽署文件產生失敗，請聯絡建立人';
    case 'pending':
    case 'processing':
      return '已簽署文件產生中，請稍後重新整理再下載';
    default:
      return '尚未簽署';
  }
}

/** variant="icon" 用於表格操作欄 */
export default function DownloadMyCopyButton({
  task,
  variant = 'button',
}: {
  task: EsignSigningTask;
  variant?: 'button' | 'icon';
}) {
  const { showSnackbar } = useSnackbar();
  const reason = notReadyReason(task.signer.completion);
  const download = useMutation({
    mutationFn: async () => {
      const blob = await downloadMyCompletedFile(task.signerPublicId);
      saveBlob(blob, `${task.document.docNumber}_${task.document.title}_已簽署.pdf`);
    },
    // 錯誤以後端訊息顯示
    meta: { suppressGlobalErrorToast: true },
    onError: (err) => showSnackbar(getErrorMessage(err, '下載失敗，請稍後再試'), 'error'),
  });

  if (variant === 'icon') {
    return (
      <TooltipIconButton
        label={reason ? `下載已簽署文件（${reason}）` : '下載已簽署文件'}
        icon={<DownloadRoundedIcon />}
        color="info"
        disabled={!!reason || download.isPending}
        onClick={() => download.mutate()}
      />
    );
  }
  return (
    <Tooltip title={reason ?? ''}>
      {/* 停用的按鈕不會觸發滑鼠事件，外包 span 讓 Tooltip 仍可顯示 */}
      <span>
        <Button
          size="large"
          variant="outlined"
          startIcon={<DownloadRoundedIcon />}
          disabled={!!reason}
          loading={download.isPending}
          onClick={() => download.mutate()}
        >
          下載已簽署文件
        </Button>
      </span>
    </Tooltip>
  );
}
