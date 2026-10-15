import ExternalSignFlow from '@/features/my-signature/external/ExternalSignFlow';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const metadata: Metadata = { title: '簽署文件', robots: { index: false, follow: false } };

const SIGNER_PUBLIC_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 外部簽署人由邀請連結（後端 bridge）換得 cookie 後導向此頁 */
export default async function ExternalSignPage({ params }: PageProps<'/external-signatures/[signerPublicId]'>) {
  const { signerPublicId } = await params;
  if (!SIGNER_PUBLIC_ID.test(signerPublicId)) notFound();
  return <ExternalSignFlow signerPublicId={signerPublicId} />;
}
