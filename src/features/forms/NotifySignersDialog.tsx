'use client';

import TooltipIconButton from '@/components/TooltipIconButton';
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import ListItem from '@mui/material/ListItem';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { SignerList, SignerRow } from './SignerList';
import type { EFormDoc, Signer } from './types';

type NotifyContentProps = {
  form: EFormDoc;
  pending: Signer[];
  onClose: () => void;
  onSend: (signerIds: string[]) => void;
};

// 放在 Dialog 內部：關閉時卸載，重新開啟時勾選狀態會重置為全選
function NotifyContent({ form, pending, onClose, onSend }: NotifyContentProps) {
  const [selected, setSelected] = useState(() => new Set(pending.map((s) => s.id)));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = pending.length > 0 && selected.size === pending.length;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(pending.map((s) => s.id)));

  return (
    <>
      <DialogTitle component="div">
        <Typography variant="sectionTitle">通知簽署人</Typography>
      </DialogTitle>
      <Divider />
      <DialogContent>
        <Stack spacing={2}>
          <Stack spacing={1}>
            {/* dialog 標題已用 700，文件名稱降為 subheading（每區塊 700 限 1 處） */}
            <Typography variant="subheading">{form.name}</Typography>
            <Typography variant="secondary">
              尚有 {pending.length} 位未簽署，選擇要提醒的對象後送出通知。
            </Typography>
          </Stack>
          {pending.length === 0 ? (
            <Typography variant="description">沒有待簽署的對象。</Typography>
          ) : (
            <SignerList>
              {/* 表頭列：全選勾選框（部分勾選時為 indeterminate）＋已選數量 */}
              <ListItem divider sx={{ gap: 1.5, py: 0.5, bgcolor: 'formBorder' }}>
                <Checkbox
                  size="small"
                  checked={allSelected}
                  indeterminate={selected.size > 0 && !allSelected}
                  onChange={toggleAll}
                  slotProps={{ input: { 'aria-label': '全選' } }}
                />
                <Typography variant="label" sx={{ flex: 1 }}>
                  全選
                </Typography>
                <Typography variant="secondary" component="span">
                  已選 {selected.size}/{pending.length} 位
                </Typography>
              </ListItem>
              {pending.map((signer) => (
                <SignerRow
                  key={signer.id}
                  signer={signer}
                  left={
                    <Checkbox
                      size="small"
                      checked={selected.has(signer.id)}
                      onChange={() => toggle(signer.id)}
                      slotProps={{ input: { 'aria-label': `通知 ${signer.name}` } }}
                    />
                  }
                  right={
                    <Typography variant="helper" sx={{ whiteSpace: 'nowrap' }}>
                      {signer.notifyCount
                        ? `已通知 ${signer.notifyCount} 次`
                        : '尚未通知過'}
                    </Typography>
                  }
                />
              ))}
            </SignerList>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button variant="outlined" onClick={onClose}>
          取消
        </Button>
        <Button
          variant="contained"
          disabled={selected.size === 0}
          onClick={() => onSend([...selected])}
        >
          送出通知
        </Button>
      </DialogActions>
    </>
  );
}

/** 操作欄的「通知」按鈕，點擊開啟通知簽署人 dialog */
export default function NotifySignersButton({
  form,
  disabled,
}: {
  form: EFormDoc;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [sentCount, setSentCount] = useState<number | null>(null);
  // 尚未串接 API：送出後先在本地累加通知次數，讓畫面反映結果
  const [extraNotified, setExtraNotified] = useState<Record<string, number>>({});

  const pending = form.signers
    .filter((s) => s.status === 'pending')
    .map((s) => ({ ...s, notifyCount: (s.notifyCount ?? 0) + (extraNotified[s.id] ?? 0) }));

  const handleSend = (signerIds: string[]) => {
    setExtraNotified((prev) => {
      const next = { ...prev };
      for (const id of signerIds) next[id] = (next[id] ?? 0) + 1;
      return next;
    });
    setOpen(false);
    setSentCount(signerIds.length);
  };

  return (
    <>
      <TooltipIconButton
        label="通知"
        icon={<NotificationsActiveRoundedIcon />}
        color="info"
        disabled={disabled}
        onClick={() => setOpen(true)}
      />
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <NotifyContent
          form={form}
          pending={pending}
          onClose={() => setOpen(false)}
          onSend={handleSend}
        />
      </Dialog>
      <Snackbar
        open={sentCount !== null}
        autoHideDuration={3000}
        onClose={() => setSentCount(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setSentCount(null)}>
          已通知 {sentCount} 位簽署人
        </Alert>
      </Snackbar>
    </>
  );
}
