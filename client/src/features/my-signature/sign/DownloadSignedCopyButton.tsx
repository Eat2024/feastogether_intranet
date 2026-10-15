'use client';

import TooltipIconButton from '@/components/TooltipIconButton';
import type { EFormDoc, Signer } from '@/features/forms/types';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Snackbar from '@mui/material/Snackbar';
import { useState } from 'react';
import { downloadCompletedPdf, isBackendId } from '@/features/forms/api';

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
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    try {
      // 後端文件：下載全員簽署完成的 PDF（完成前無法下載）
      if (isBackendId(form.id)) {
        const result = await downloadCompletedPdf(form.id, `${form.name}_已完成.pdf`);
        if (result) setError(result.error);
        return;
      }
      // 產生 PDF 的套件較大，點擊時才載入
      const { downloadSignedCopy } = await import('./signedPdf');
      await downloadSignedCopy(form, me);
    } catch {
      setError('下載失敗，請稍後再試');
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
        open={error !== null}
        autoHideDuration={4000}
        onClose={() => setError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Snackbar>
    </>
  );
}
