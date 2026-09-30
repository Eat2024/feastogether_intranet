'use client';

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

const MAX_REASON = 200;

/** 拒絕簽署：原因選填；拒絕後其他簽署人仍可繼續簽署 */
export default function RejectDialog({
  open,
  docName,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  docName: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <Dialog open={open} onClose={pending ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle component="div">
        <Typography variant="sectionTitle">拒絕簽署</Typography>
      </DialogTitle>
      <Divider />
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="secondary">
            確定拒絕簽署「{docName}」？拒絕後無法再簽署此文件，其他簽署人仍可繼續簽署。
          </Typography>
          <TextField
            label="拒絕原因（選填）"
            multiline
            minRows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, MAX_REASON))}
            helperText={`${reason.length}/${MAX_REASON}`}
            disabled={pending}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button variant="outlined" onClick={onClose} disabled={pending}>
          取消
        </Button>
        <Button variant="contained" color="error" onClick={() => onConfirm(reason)} loading={pending}>
          確認拒絕
        </Button>
      </DialogActions>
    </Dialog>
  );
}
