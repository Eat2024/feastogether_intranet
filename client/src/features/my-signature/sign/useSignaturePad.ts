'use client';

// 閱讀與簽名步驟的共用狀態（內部 SignFlow、外部 ExternalSignForm）：已簽欄位、目前頁面、簽名板與勾選閱讀
import type { UploadField } from '@/features/forms/types';
import { useState } from 'react';

/** fields 為需要簽名的欄位（依頁面順序）；initialPage 為一開始停留的頁面 */
export function useSignaturePad(fields: UploadField[], initialPage: number) {
  const [readAgreed, setReadAgreed] = useState(false);
  const [signatures, setSignatures] = useState<Record<number, string>>({});
  const [activePage, setActivePage] = useState(initialPage);
  const [padField, setPadField] = useState<UploadField | null>(null);

  const allSigned = fields.every((f) => signatures[f.id]);

  const openPad = (f: UploadField) => {
    setActivePage(f.page);
    setPadField(f);
  };

  const confirmSignature = (dataUrl: string) => {
    if (!padField) return;
    const next = { ...signatures, [padField.id]: dataUrl };
    setSignatures(next);
    setPadField(null);
    // 自動切到下一個尚未簽名的欄位所在頁面（不自動開啟簽名板）
    const nextField = fields.find((f) => !next[f.id]);
    if (nextField) setActivePage(nextField.page);
  };

  return {
    readAgreed,
    setReadAgreed,
    signatures,
    activePage,
    setActivePage,
    padField,
    openPad,
    closePad: () => setPadField(null),
    confirmSignature,
    /** 同意條款之後的步驟：閱讀文件 1 → 完成簽名 2 → 確認送出 3 */
    activeStep: !readAgreed ? 1 : !allSigned ? 2 : 3,
  };
}
