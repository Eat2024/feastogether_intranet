'use client';

import TooltipIconButton from '@/components/TooltipIconButton';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { SignerList, SignerRow } from './SignerList';
import { signedCount } from './status';
import type { EFormDoc, Signer } from './types';

const SIGN_STATUS_TEXT: Record<Signer['status'], (s: Signer) => string> = {
  signed: (s) => `已簽署・${s.signedAt}`,
  rejected: (s) => `已拒絕・${s.rejectedAt}`,
  pending: () => '待簽署',
};

// success／error 主色白底對比不足，文字用 dark
const SIGN_STATUS_COLOR: Record<Signer['status'], string> = {
  signed: 'success.dark',
  rejected: 'error.dark',
  pending: 'text.secondary',
};

function SignStatus({ signer }: { signer: Signer }) {
  return (
    <Typography
      variant="content"
      component="span"
      sx={{ color: SIGN_STATUS_COLOR[signer.status], whiteSpace: 'nowrap' }}
    >
      {SIGN_STATUS_TEXT[signer.status](signer)}
    </Typography>
  );
}

type SignProgressDialogProps = {
  form: EFormDoc;
  open: boolean;
  onClose: () => void;
};

export function SignProgressDialog({
  form,
  open,
  onClose,
}: SignProgressDialogProps) {
  const total = form.signers.length;

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
            {/* 文件編號靠左（有才顯示），簽署進度永遠靠右 */}
            <Box sx={{ display: 'flex', gap: 2 }}>
              {form.docNumber && (
                <Typography variant="secondary">
                  文件編號 {form.docNumber}
                </Typography>
              )}
              <Typography
                variant="secondary"
                sx={{ ml: 'auto', whiteSpace: 'nowrap' }}
              >
                簽署進度 {signedCount(form)}/{total}
              </Typography>
            </Box>
          </Stack>
          {total === 0 ? (
            <Typography variant="description">尚未設定簽署人。</Typography>
          ) : (
            <SignerList>
              {form.signers.map((signer) => (
                <SignerRow
                  key={signer.id}
                  signer={signer}
                  right={<SignStatus signer={signer} />}
                />
              ))}
            </SignerList>
          )}
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

/** 操作欄的「檢視」按鈕，點擊開啟簽署進度 dialog */
export default function ViewSignProgressButton({
  form,
  disabled,
}: {
  form: EFormDoc;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <TooltipIconButton
        label="檢視"
        icon={<VisibilityRoundedIcon />}
        color="info"
        disabled={disabled}
        onClick={() => setOpen(true)}
      />
      <SignProgressDialog
        form={form}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
