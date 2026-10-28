'use client';

import { downloadExternalCompletedFile } from '@/api/requests';
import type { ExternalSigningTask } from '@/api/types';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import InfoRoundedIcon from '@mui/icons-material/InfoRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMutation } from '@tanstack/react-query';
import { taipeiDateTime } from './taskForm';

type CopyStatus = ExternalSigningTask['signer']['completion']['status'];

type ExternalDoneProps = {
  task: ExternalSigningTask;
  signedAt: string;
  /** 本人副本的最新產製狀態（產生中時由呼叫端自動更新） */
  copyStatus: CopyStatus;
  onError: (error: Error) => void;
};

/** 簽署完成：顯示本人的簽署結果，副本產生後可下載本人的已簽署文件 */
export default function ExternalDone({ task, signedAt, copyStatus, onError }: ExternalDoneProps) {
  return (
    <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
      <Stack spacing={3}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <CheckCircleRoundedIcon sx={{ flex: 'none', fontSize: 48, color: 'success.main' }} />
          <Stack spacing={1}>
            <Typography variant="sectionTitle" component="h2">
              簽署完成
            </Typography>
            <Typography variant="description">您已完成「{task.document.title}」的簽署，感謝您的配合。</Typography>
          </Stack>
        </Stack>

        <Box
          component="dl"
          sx={{ m: 0, display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', columnGap: 3, rowGap: 1 }}
        >
          <Typography component="dt" variant="label">
            簽署人
          </Typography>
          <Typography component="dd" variant="content" sx={{ m: 0, overflowWrap: 'anywhere' }}>
            {task.signer.name}（{task.signer.email}）
          </Typography>
          <Typography component="dt" variant="label">
            簽署時間
          </Typography>
          <Typography component="dd" variant="content" sx={{ m: 0 }}>
            {taipeiDateTime(signedAt)}
          </Typography>
        </Box>

        <CopyDownload status={copyStatus} onError={onError} />

        <Alert severity="info" role="note" icon={<InfoRoundedIcon />}>
          之後可隨時再次開啟邀請信中的連結下載，請妥善保管邀請信，不要轉寄給他人。
        </Alert>
      </Stack>
    </Paper>
  );
}

/** 依副本狀態顯示：可下載、產生中（按鈕停用轉圈）、產製失敗（請向文件發起人索取） */
function CopyDownload({ status, onError }: { status: CopyStatus; onError: (error: Error) => void }) {
  const download = useMutation({
    mutationFn: downloadExternalCompletedFile,
    onError,
    onSuccess: ({ bytes, fileName }) => {
      const url = URL.createObjectURL(bytes);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    },
  });
  if (status === 'failed') {
    return (
      <Alert severity="error" icon={<ErrorOutlineRoundedIcon />}>
        已簽署文件暫時無法產生，您的簽署已完成並保存，請向文件發起人索取文件。
      </Alert>
    );
  }
  const ready = status === 'ready';
  return (
    <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
      {/* 讀取 Blob 前先處理授權錯誤；成功才建立下載連結。 */}
      <Button
        onClick={() => download.mutate()}
        loading={download.isPending}
        variant="contained"
        size="large"
        disabled={!ready || download.isPending}
        aria-busy={!ready}
        startIcon={ready ? <DownloadRoundedIcon /> : <CircularProgress size={20} color="inherit" />}
      >
        下載已簽署文件
      </Button>
      <Typography variant="helper">
        {ready
          ? '您的個人簽署副本（PDF），文件上附有簽章驗證 QR Code，可供他人查驗。'
          : '文件產生中，通常幾秒內即可完成，完成後就能下載。'}
      </Typography>
    </Stack>
  );
}
