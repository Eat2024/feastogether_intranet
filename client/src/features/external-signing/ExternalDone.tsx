import { externalCompletedFileUrl } from '@/api/requests';
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
import { taipeiDateTime } from './taskForm';

type CopyStatus = ExternalSigningTask['signer']['completion']['status'];

type ExternalDoneProps = {
  task: ExternalSigningTask;
  signedAt: string;
  /** 本人副本的最新產製狀態（產生中時由呼叫端自動更新） */
  copyStatus: CopyStatus;
};

/** 簽署完成：顯示本人的簽署結果，副本產生後可下載本人的已簽署文件 */
export default function ExternalDone({ task, signedAt, copyStatus }: ExternalDoneProps) {
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

        <CopyDownload status={copyStatus} />

        <Alert severity="info" role="note" icon={<InfoRoundedIcon />}>
          之後可隨時再次開啟邀請信中的連結下載，請妥善保管邀請信，不要轉寄給他人。
        </Alert>
      </Stack>
    </Paper>
  );
}

/** 依副本狀態顯示：可下載、產生中（按鈕停用轉圈）、產製失敗（請向文件發起人索取） */
function CopyDownload({ status }: { status: CopyStatus }) {
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
      {/* 一般連結直接下載附件：指定 component="a"，不經 Next.js Link（theme 預設）與 axios */}
      <Button
        component="a"
        href={ready ? externalCompletedFileUrl() : undefined}
        variant="contained"
        size="large"
        disabled={!ready}
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
