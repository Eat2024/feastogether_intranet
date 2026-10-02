'use client';

import TooltipIconButton from '@/components/TooltipIconButton';
import { SignerList, SignerRow } from '@/features/forms/SignerList';
import SignStatusText from '@/features/forms/SignStatusText';
import type { FormProgress } from '@/features/forms/status';
import type { EFormDoc, Signer } from '@/features/forms/types';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

/**
 * 簽署人視角的簽署狀態：只顯示本人的簽署紀錄與文件整體進度，不列出其他簽署人。
 * （發起人看完整名單請至「電子簽列表」→ 檢視）
 */
function MySignProgressDialog({
  form,
  me,
  progress,
  open,
  onClose,
}: {
  form: EFormDoc;
  me: Signer;
  progress: FormProgress;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle component="div">
        <Typography variant="sectionTitle">檢視簽署狀態</Typography>
      </DialogTitle>
      <Divider />
      <DialogContent>
        <Stack spacing={2}>
          <Stack spacing={1}>
            {/* dialog 標題已用 700，文件名稱降為 subheading（每區塊 700 限 1 處） */}
            <Typography variant="subheading">{form.name}</Typography>
            {form.docNumber && <Typography variant="secondary">文件編號 {form.docNumber}</Typography>}
          </Stack>

          <Box>
            <Typography variant="label" component="div" sx={{ mb: 1 }}>
              你的簽署紀錄
            </Typography>
            <SignerList>
              <SignerRow signer={me} right={<SignStatusText signer={me} />} />
            </SignerList>
            {me.rejectReason && (
              <Typography variant="secondary" component="div" sx={{ mt: 1 }}>
                拒絕原因：{me.rejectReason}
              </Typography>
            )}
          </Box>

          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="label" component="span">
                文件整體進度
              </Typography>
              <Typography variant="secondary" component="span">
                已簽署 {progress.signed}/{progress.total}
                {progress.rejected > 0 && `・已拒絕 ${progress.rejected}`}
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={progress.total ? (progress.signed / progress.total) * 100 : 0}
            />
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button variant="contained" onClick={onClose}>
          關閉
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** 「我的電子簽」操作欄的「檢視」按鈕 */
export default function MySignProgressButton(props: { form: EFormDoc; me: Signer; progress: FormProgress }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TooltipIconButton label="檢視" icon={<VisibilityRoundedIcon />} color="info" onClick={() => setOpen(true)} />
      <MySignProgressDialog {...props} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
