'use client';

import { signatureVerifyUrl } from '@/lib/signatureQr';
import Box from '@mui/material/Box';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** 簽名追蹤 QR code（顯示在簽名欄位右下角）；內容為 /verify/<識別碼> */
export default function SignatureQr({ signatureId }: { signatureId: string }) {
  const [src, setSrc] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(signatureVerifyUrl(signatureId, window.location.origin), {
      margin: 0,
      errorCorrectionLevel: 'M',
      width: 192,
    }).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [signatureId]);

  return (
    <Box
      component={src ? 'img' : 'span'}
      src={src}
      alt="簽名追蹤 QR code"
      title={`簽名識別碼 ${signatureId}`}
      sx={{ display: 'block', height: '100%', aspectRatio: '1 / 1', bgcolor: 'common.white', flexShrink: 0 }}
    />
  );
}
