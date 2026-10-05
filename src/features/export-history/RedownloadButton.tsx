'use client';

import TooltipIconButton from '@/components/TooltipIconButton';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { getRedownloadCopy, redownloadList } from './actions';
import { checkPassword, PASSWORD_MIN } from './password';
import type { ExportKind } from './types';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const base64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** 重新下載匯出文件：先設定開啟密碼，下載的檔案需輸入此密碼才能開啟 */
export default function RedownloadButton({ recordId, kind }: { recordId: string; kind: ExportKind }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const passwordError = checkPassword(password);
  const confirmError = confirm !== password ? '兩次輸入的密碼不一致' : null;

  const reset = () => {
    setOpen(false);
    setPassword('');
    setConfirm('');
    setShow(false);
    setTouched(false);
    setError(null);
  };
  const close = () => {
    if (!busy) reset();
  };

  const submit = async () => {
    setTouched(true);
    if (passwordError || confirmError) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === 'list') {
        const res = await redownloadList({ recordId, password });
        if ('error' in res) return setError(res.error);
        saveBlob(new Blob([base64ToBytes(res.base64)], { type: XLSX_MIME }), res.fileName);
      } else {
        const res = await getRedownloadCopy({ recordId });
        if ('error' in res) return setError(res.error);
        // 產生 PDF 的套件較大，點擊時才載入；密碼只在瀏覽器端使用，不會傳到伺服器
        const { downloadSignedCopy } = await import('@/features/my-signature/sign/signedPdf');
        await downloadSignedCopy(res.form, res.signer, { fileName: res.fileName, password });
      }
      reset();
      setDone(true);
    } catch (e) {
      setError(
        e instanceof Error && e.message === 'INSECURE_CONTEXT'
          ? '加密 PDF 需要以 HTTPS 開啟本系統，請聯絡系統管理員'
          : '下載失敗，請稍後再試',
      );
    } finally {
      setBusy(false);
    }
  };

  const visibility = (
    <InputAdornment position="end">
      <IconButton
        size="small"
        edge="end"
        aria-label={show ? '隱藏密碼' : '顯示密碼'}
        onClick={() => setShow((v) => !v)}
      >
        {show ? <VisibilityOffRoundedIcon fontSize="small" /> : <VisibilityRoundedIcon fontSize="small" />}
      </IconButton>
    </InputAdornment>
  );

  return (
    <>
      <TooltipIconButton
        label="重新下載"
        icon={<FileDownloadRoundedIcon />}
        color="info"
        onClick={() => setOpen(true)}
      />
      <Dialog open={open} onClose={close} fullWidth maxWidth="xs">
        <DialogTitle>設定檔案開啟密碼</DialogTitle>
        <Divider />
        <DialogContent>
          <Stack
            component="form"
            spacing={2}
            sx={{ pt: 1 }}
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Typography variant="description">
              重新下載的檔案含個人資料，需輸入下方密碼才能開啟。系統不會保存密碼，請自行記下，並以其他管道告知收件人。
            </Typography>
            {kind === 'list' && (
              <Typography variant="helper">
                簽署紀錄清單會依當時的匯出條件，以目前的資料重新產生。
              </Typography>
            )}
            <TextField
              size="small"
              label="開啟密碼"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={touched && !!passwordError}
              helperText={touched && passwordError ? passwordError : `至少 ${PASSWORD_MIN} 個字元，需包含英文字母與數字`}
              slotProps={{ input: { endAdornment: visibility } }}
            />
            <TextField
              size="small"
              label="確認密碼"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              error={touched && !!confirmError}
              helperText={touched && confirmError ? confirmError : ' '}
            />
            {error && <Alert severity="error">{error}</Alert>}
            {/* 讓 Enter 可送出 */}
            <button type="submit" hidden />
          </Stack>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button variant="outlined" onClick={close} disabled={busy}>
            取消
          </Button>
          <Button variant="contained" startIcon={<FileDownloadRoundedIcon />} loading={busy} onClick={submit}>
            加密並下載
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={done}
        autoHideDuration={4000}
        onClose={() => setDone(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setDone(false)}>
          已下載加密檔案，開啟時請輸入剛才設定的密碼
        </Alert>
      </Snackbar>
    </>
  );
}
