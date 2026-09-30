import PageHeader from '@/components/PageHeader';
import { CURRENT_USER_ID } from '@/features/forms/mock';
import { getForm, toClientForm, todayStr } from '@/features/forms/store';
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
  const storedMe = stored?.signers.find((s) => s.id === CURRENT_USER_ID);
  // 不是簽署人就當作不存在，不透露文件資訊
  if (!stored || !storedMe || stored.status === 'draft') notFound();

  // 只把本人的簽名資料傳給畫面
  const form = toClientForm(stored, CURRENT_USER_ID);
  const me = form.signers.find((s) => s.id === CURRENT_USER_ID)!;
  const block = getSignBlock(form, me, new Date());

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
