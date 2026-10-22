import PublicPageShell from '@/components/PublicPageShell';
import ExternalSigning from '@/features/external-signing/ExternalSigning';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: '簽署文件' };

/**
 * 外部（Email）簽署人的簽署頁：邀請確認後由後端 303 導向此頁。
 * 不在 (main) 版面內，沒有員工側邊欄，只有深色「電子簽署」頁首；任務資料由 ExternalSigning 在瀏覽器端取得。
 */
export default async function ExternalSigningPage({ params }: PageProps<'/external-signatures/[signerPublicId]'>) {
  const { signerPublicId } = await params;

  return (
    <PublicPageShell>
      <ExternalSigning signerPublicId={signerPublicId} />
    </PublicPageShell>
  );
}
