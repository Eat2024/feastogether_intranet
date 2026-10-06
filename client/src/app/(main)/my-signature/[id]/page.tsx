import PageHeader from '@/components/PageHeader';
import { getCurrentUserId } from '@/features/forms/orgChart';
import { getForm, toSignerView, todayStr } from '@/features/forms/store';
import DownloadSignedCopyButton from '@/features/my-signature/sign/DownloadSignedCopyButton';
import { getSignBlock } from '@/features/my-signature/sign/eligibility';
import ReadOnlyDocument from '@/features/my-signature/sign/ReadOnlyDocument';
import SignFlow from '@/features/my-signature/sign/SignFlow';
import Alert from '@mui/material/Alert';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const metadata: Metadata = { title: '簽署文件' };
export const dynamic = 'force-dynamic';

export default async function SignDocumentPage({
  params,
}: PageProps<'/my-signature/[id]'>) {
  const stored = getForm((await params).id);
  const userId = getCurrentUserId();
  const storedMe = stored?.signers.find((s) => s.id === userId);
  // 不是簽署人就當作不存在，不透露文件資訊
  if (!stored || !storedMe || stored.status === 'draft') notFound();

  // 以完整資料判斷可否簽署，再只把本人的紀錄傳給畫面（不外流其他簽署人）
  const block = getSignBlock(stored, storedMe, new Date());
  const form = toSignerView(stored, userId);
  const me = form.signers[0];

  return (
    <>
      <PageHeader
        title={form.name}
        description={[
          form.docNumber,
          `發起人 ${form.createdBy.name}（${form.createdBy.employeeNo}）`,
          `簽署期限 ${form.endAt ?? '不限'}`,
        ]
          .filter(Boolean)
          .join('・')}
      />
      {block ? (
        <>
          <Alert
            severity={me.status === 'signed' ? 'success' : 'info'}
            variant="outlined"
            action={
              me.status === 'signed' ? (
                <DownloadSignedCopyButton form={form} me={me} />
              ) : undefined
            }
          >
            {block}
          </Alert>
          <ReadOnlyDocument form={form} me={me} />
        </>
      ) : (
        <SignFlow form={form} me={me} today={todayStr()} />
      )}
    </>
  );
}
