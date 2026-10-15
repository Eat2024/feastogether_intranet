import ExternalCompletion from '@/features/my-signature/external/ExternalCompletion';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const metadata: Metadata = { title: '簽署結果', robots: { index: false, follow: false } };

const SIGNER_PUBLIC_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 外部簽署人完成簽署後，以回執查看處理狀態與完成文件 */
export default async function ExternalCompletionPage({
  params,
}: PageProps<'/external-signatures/[signerPublicId]/completion'>) {
  const { signerPublicId } = await params;
  if (!SIGNER_PUBLIC_ID.test(signerPublicId)) notFound();
  return <ExternalCompletion signerPublicId={signerPublicId} />;
}
