'use client';

// 補簽邀請連結（備用）：GET /api/esign/documents/:id/reopening-invitations。
// 補簽後系統會自動寄送新的邀請信給所有未簽署者；此處只列出「尚未寄達」的邀請連結，
// 供寄送失敗時由建立人手動轉交。已寄達的不會列出，寄送結果以通知紀錄為準。
// 連結即簽署憑證：只在開啟對話框時讀取、不保留在快取中，也不寫進網址或紀錄。
import { useGetReopeningInvitationsQuery } from '@/api/queries';
import type { EsignManagedSignerView } from '@/api/types';
import { useSnackbar } from '@/components/providers/SnackbarProvider';
import { getErrorMessage } from '@/lib/apiError';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { notificationTime } from './notificationLabels';

export default function ReopeningInvitationsButton({
  documentId,
  signers,
  disabled,
}: {
  documentId: string;
  /** 用來顯示連結屬於哪位簽署人 */
  signers: Pick<EsignManagedSignerView, 'publicId' | 'name' | 'email'>[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="large"
        variant="outlined"
        startIcon={<LinkRoundedIcon />}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        補簽邀請連結
      </Button>
      {open && <InvitationsDialog documentId={documentId} signers={signers} onClose={() => setOpen(false)} />}
    </>
  );
}

function InvitationsDialog({
  documentId,
  signers,
  onClose,
}: {
  documentId: string;
  signers: Pick<EsignManagedSignerView, 'publicId' | 'name' | 'email'>[];
  onClose: () => void;
}) {
  const { showSnackbar } = useSnackbar();
  const { data, isPending, isError, error } = useGetReopeningInvitationsQuery(documentId);
  const signerOf = (publicId: string) => signers.find((s) => s.publicId === publicId);

  const copy = async (name: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      showSnackbar(`已複製 ${name} 的補簽連結`, 'success');
    } catch {
      showSnackbar('無法複製，請選取連結後手動複製', 'error');
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>補簽邀請連結</DialogTitle>
      <Divider />
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="description">
            補簽後系統已自動寄送新的邀請信。以下只列出尚未寄達的邀請連結，信件寄送失敗時可手動轉交給本人；
            連結即簽署憑證，請勿公開分享。寄送結果請見通知紀錄。
          </Typography>
          {isPending ? (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 3 }}>
              <CircularProgress size={20} />
              <Typography variant="description">讀取連結中…</Typography>
            </Box>
          ) : isError ? (
            <Alert severity="error">無法取得補簽連結：{getErrorMessage(error)}</Alert>
          ) : data.length === 0 ? (
            <Alert severity="info" variant="outlined">
              補簽邀請信都已寄出，沒有需要手動轉交的連結；寄送結果請見通知紀錄。
            </Alert>
          ) : (
            data.map((inv) => {
              const signer = signerOf(inv.signerPublicId);
              const name = signer?.name ?? '簽署人';
              return (
                <Box key={inv.signerPublicId}>
                  <Typography variant="content" component="div">
                    {name}
                    {signer?.email && signer.email !== name && (
                      <Typography variant="helper" component="span" sx={{ ml: 1 }}>
                        {signer.email}
                      </Typography>
                    )}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
                    <TextField
                      size="small"
                      fullWidth
                      value={inv.invitationUrl}
                      slotProps={{ htmlInput: { readOnly: true, 'aria-label': `${name} 的補簽連結` } }}
                      onFocus={(e) => e.target.select()}
                    />
                    <Button
                      variant="outlined"
                      startIcon={<ContentCopyRoundedIcon />}
                      onClick={() => void copy(name, inv.invitationUrl)}
                      sx={{ flexShrink: 0 }}
                    >
                      複製
                    </Button>
                  </Box>
                  <Typography variant="helper" component="div" sx={{ mt: 0.5 }}>
                    連結有效至 {notificationTime(inv.expiresAt)}
                  </Typography>
                </Box>
              );
            })
          )}
        </Stack>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button variant="contained" onClick={onClose}>
          關閉
        </Button>
      </DialogActions>
    </Dialog>
  );
}
