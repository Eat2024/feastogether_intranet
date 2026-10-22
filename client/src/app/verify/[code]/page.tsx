import PublicPageShell from '@/components/PublicPageShell';
import SignatureVerificationView from '@/features/signature-verification/SignatureVerificationView';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '簽章驗證',
  // 驗證網址含驗證代碼：不送出 referrer、不讓搜尋引擎收錄
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

/**
 * 公開簽章驗證頁：已簽署 PDF 上的 QR Code 指向此頁（{EXTERNAL_SIGNING_ORIGIN}/verify/{驗證代碼}）。
 * 不需登入；驗證結果由 SignatureVerificationView 在瀏覽器端查詢。
 */
export default async function SignatureVerificationPage({ params }: PageProps<'/verify/[code]'>) {
  const { code } = await params;

  return (
    <PublicPageShell>
      <SignatureVerificationView code={code} />
    </PublicPageShell>
  );
}
