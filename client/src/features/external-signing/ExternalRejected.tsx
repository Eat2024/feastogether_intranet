import DoNotDisturbOnRoundedIcon from '@mui/icons-material/DoNotDisturbOnRounded';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { taipeiDateTime } from './taskForm';

type ExternalRejectedProps = {
  rejectedAt: string;
  /** 拒絕原因；未填為空字串 */
  reason: string;
};

/** 已拒絕簽署：顯示拒絕時間與原因。已拒絕的人不能再讀原始 PDF 或簽署，頁面沒有其他操作 */
export default function ExternalRejected({ rejectedAt, reason }: ExternalRejectedProps) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, borderRadius: 2 }}>
      <Stack spacing={3}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
          <DoNotDisturbOnRoundedIcon sx={{ flex: 'none', mt: 0.25, color: 'error.dark' }} />
          <Typography variant="body">您已於 {taipeiDateTime(rejectedAt)} 拒絕簽署此文件。</Typography>
        </Stack>
        <Divider />
        <Stack spacing={1}>
          <Typography variant="label">拒絕原因</Typography>
          <Typography
            variant={reason ? 'content' : 'secondary'}
            sx={{ p: 2, borderRadius: 2, bgcolor: 'background.default', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
          >
            {reason || '未填寫'}
          </Typography>
        </Stack>
        <Typography variant="helper">
          此文件已無法再由您簽署，其他簽署人仍可繼續簽署。如需重新處理，請聯絡文件發起人。
        </Typography>
      </Stack>
    </Paper>
  );
}
