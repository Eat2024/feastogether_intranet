'use client';

import { ACTION_FAILED_MESSAGE } from '@/lib/actionError';
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
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { addSheetSigners, loadOrgTree } from '../actions';
import EmailSignerInput, { type EmailSigner } from '../editor/EmailSignerInput';
import StaffTreePicker from '../editor/StaffTreePicker';
import type { OrgDept } from '../types';

/** 從組織架構移除已在名單中的人（沒有人的部門一併移除），避免重複選取 */
function withoutExisting(depts: OrgDept[], existing: Set<string>): OrgDept[] {
  return depts.flatMap((d) => {
    const children = withoutExisting(d.children, existing);
    const employees = d.employees.filter((e) => !existing.has(e.id));
    const total = employees.length + children.reduce((n, c) => n + c.total, 0);
    return total > 0 ? [{ ...d, children, employees, total }] : [];
  });
}

/** 簽到表發起後追加簽署人：從組織架構勾選，或以 Email 加入 */
export default function AddSignersDialog({
  open,
  formId,
  existingIds,
  existingEmails,
  onClose,
  onAdded,
}: {
  open: boolean;
  formId: string;
  /** 已在名單中的簽署人 id（組織架構同仁） */
  existingIds: string[];
  /** 已在名單中的 Email（小寫） */
  existingEmails: string[];
  onClose: () => void;
  onAdded: (count: number) => void;
}) {
  const [org, setOrg] = useState<OrgDept[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [emails, setEmails] = useState<EmailSigner[]>([]);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  // 第一次開啟時才載入組織架構
  useEffect(() => {
    if (!open || org) return;
    let cancelled = false;
    loadOrgTree()
      .then((tree) => !cancelled && setOrg(tree))
      .catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
    };
  }, [open, org]);

  const available = useMemo(() => (org ? withoutExisting(org, new Set(existingIds)) : null), [org, existingIds]);
  const duplicateEmails = emails.filter((e) => existingEmails.includes(e.email.toLowerCase()));
  const total = selected.size + emails.length;

  const close = () => {
    if (pending) return;
    setSelected(new Set());
    setEmails([]);
    setError(undefined);
    onClose();
  };

  const submit = () => {
    if (total === 0) return setError('請至少選擇一位要追加的人員');
    if (duplicateEmails.length) return setError(`${duplicateEmails.map((e) => e.email).join('、')} 已在名單中`);
    setError(undefined);
    startTransition(async () => {
      try {
        const res = await addSheetSigners({ formId, signerIds: [...selected], emailSigners: emails });
        if ('error' in res) return setError(res.error);
        setSelected(new Set());
        setEmails([]);
        onAdded(res.added);
      } catch {
        setError(ACTION_FAILED_MESSAGE);
      }
    });
  };

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="md">
      <DialogTitle>追加簽署人</DialogTitle>
      <Divider />
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <Typography variant="description">
            追加的人會排在原名單後面、標示「臨時加入」，並計入應到人數；簽到前若加錯，可在名單中移除。已在名單中的人不會出現在下方。
          </Typography>
          {loadError ? (
            <Alert severity="error">無法載入組織架構，請重新整理後再試。</Alert>
          ) : !available ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={28} aria-label="載入組織架構中" />
            </Box>
          ) : (
            <StaffTreePicker org={available} selected={selected} onChange={setSelected} />
          )}
          <EmailSignerInput value={emails} onChange={setEmails} />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Typography variant="secondary" component="span" sx={{ mr: 'auto' }}>
          本次追加 {total} 人（組織架構 {selected.size}、Email {emails.length}）
        </Typography>
        <Button variant="outlined" onClick={close} disabled={pending}>
          取消
        </Button>
        <Button variant="contained" onClick={submit} loading={pending} disabled={total === 0}>
          確定追加
        </Button>
      </DialogActions>
    </Dialog>
  );
}
