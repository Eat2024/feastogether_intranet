'use client';

import TooltipIconButton from '@/components/TooltipIconButton';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import { useState } from 'react';
import { getSignerCopy } from '../actions';

/** 匯出某位簽署人的已簽署文件（PDF）；簽名圖檔點擊時才向伺服器取得 */
export default function ExportSignerCopyButton({
  formId,
  signerId,
  disabled,
  onError,
}: {
  formId: string;
  signerId: string;
  disabled?: boolean;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  const exportCopy = async () => {
    setBusy(true);
    try {
      const res = await getSignerCopy({ formId, signerId });
      if ('error' in res) {
        onError(res.error);
        return;
      }
      // 產生 PDF 的套件較大，點擊時才載入
      const { downloadSignedCopy } = await import('@/features/my-signature/sign/signedPdf');
      const { form, signer } = res;
      await downloadSignedCopy(form, signer, {
        fileName: `${form.docNumber ?? form.id}_${form.name}_${signer.name}${signer.employeeNo}_已簽署.pdf`,
      });
    } catch {
      onError('匯出失敗，請稍後再試');
    } finally {
      setBusy(false);
    }
  };

  return (
    <TooltipIconButton
      label={busy ? '匯出中…' : '匯出已簽署文件'}
      icon={<FileDownloadRoundedIcon />}
      color="info"
      disabled={disabled || busy}
      onClick={exportCopy}
    />
  );
}
