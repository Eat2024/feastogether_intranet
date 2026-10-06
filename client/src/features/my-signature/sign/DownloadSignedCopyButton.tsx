'use client';

import TooltipIconButton from '@/components/TooltipIconButton';
import type { EFormDoc, Signer } from '@/features/forms/types';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Snackbar from '@mui/material/Snackbar';
import { useState } from 'react';

/** 下載本人已簽署的副本；variant="icon" 用於表格操作欄 */
export default function DownloadSignedCopyButton({
  form,
  me,
  variant = 'button',
}: {
  form: EFormDoc;
  me: Signer;
  variant?: 'button' | 'icon';
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      // 產生 PDF 的套件較大，點擊時才載入
      const { downloadSignedCopy } = await import('./signedPdf');
      await downloadSignedCopy(form, me);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {variant === 'icon' ? (
        <TooltipIconButton
          label="下載已簽署文件"
          icon={<DownloadRoundedIcon />}
          color="info"
          disabled={busy}
          onClick={download}
        />
      ) : (
        <Button size="large" variant="outlined" startIcon={<DownloadRoundedIcon />} loading={busy} onClick={download}>
          下載已簽署文件
        </Button>
      )}
      <Snackbar
        open={error}
        autoHideDuration={4000}
        onClose={() => setError(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setError(false)}>
          下載失敗，請稍後再試
        </Alert>
      </Snackbar>
    </>
  );
}
