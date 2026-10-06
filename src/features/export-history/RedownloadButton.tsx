'use client';

import TooltipIconButton from '@/components/TooltipIconButton';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import { useState } from 'react';
import { getRedownloadCopy, redownloadList } from './actions';
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

/**
 * 重新下載匯出文件。簽署紀錄清單依當時的匯出條件、以目前資料重新產生。
 * （設定開啟密碼的功能暫時拿掉；actions 與 downloadSignedCopy 仍保留 password 參數，之後可直接接回）
 */
export default function RedownloadButton({ recordId, kind }: { recordId: string; kind: ExportKind }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    try {
      if (kind === 'list') {
        const res = await redownloadList({ recordId });
        if ('error' in res) return setError(res.error);
        saveBlob(new Blob([base64ToBytes(res.base64)], { type: XLSX_MIME }), res.fileName);
      } else {
        const res = await getRedownloadCopy({ recordId });
        if ('error' in res) return setError(res.error);
        // 產生 PDF 的套件較大，點擊時才載入
        const { downloadSignedCopy } = await import('@/features/my-signature/sign/signedPdf');
        await downloadSignedCopy(res.form, res.signer, { fileName: res.fileName });
      }
    } catch {
      setError('下載失敗，請稍後再試');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TooltipIconButton
        label={busy ? '下載中…' : '重新下載'}
        icon={<FileDownloadRoundedIcon />}
        color="info"
        disabled={busy}
        onClick={download}
      />
      <Snackbar
        open={!!error}
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
