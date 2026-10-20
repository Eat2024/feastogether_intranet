import type { ExternalSigningTask } from '@/api/types';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { taipeiDateTime } from './taskForm';

/** 簽署完成：顯示本人的簽署結果（下載本人副本另見 Spec 008 ticket 05） */
export default function ExternalDone({ task, signedAt }: { task: ExternalSigningTask; signedAt: string }) {
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
      </Stack>
    </Paper>
  );
}
