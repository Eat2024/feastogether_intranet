import PageHeader from '@/components/PageHeader';
import { getCurrentUserId } from '@/features/forms/orgChart';
import SheetView from '@/features/forms/sheet/SheetView';
import { signingPeriod } from '@/features/forms/status';
import { getForm, toSignerView, todayStr } from '@/features/forms/store';
import DownloadSignedCopyButton from '@/features/my-signature/sign/DownloadSignedCopyButton';
import { getSignBlock } from '@/features/my-signature/sign/eligibility';
import ReadOnlyDocument from '@/features/my-signature/sign/ReadOnlyDocument';
import SheetSignFlow from '@/features/my-signature/sign/SheetSignFlow';
import SignFlow from '@/features/my-signature/sign/SignFlow';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const metadata: Metadata = { title: '簽署文件' };
export const dynamic = 'force-dynamic';

export default async function SignDocumentPage({
  params,
}: PageProps<'/my-signature/[id]'>) {
  const stored = getForm((await params).id);
  const userId = getCurrentUserId();
  if (!stored || stored.status === 'draft') notFound();
  const storedMe = stored.signers.find((s) => s.id === userId);
  // 不是簽署人就當作不存在，不透露文件資訊
  if (!storedMe) notFound();

  // 以完整資料判斷可否簽署，再只把本人的紀錄傳給畫面（不外流其他簽署人）
  const block = getSignBlock(stored, storedMe, new Date());
  const form = toSignerView(stored, userId);
  const me = form.signers[0] ?? storedMe;
  const period = signingPeriod(form);
  const sheet = stored.docType === 'sheet' ? stored.sheet : undefined;
  const rowNo = sheet ? (me.rowNo ?? 1) : 0;

  // 返回時停在這份文件所屬的分頁（待簽署／已簽署／已拒絕）
  const backHref =
    me.status === 'signed' ? '/my-signature?tab=signed' : me.status === 'rejected' ? '/my-signature?tab=rejected' : '/my-signature';

  return (
    <>
      <Box>
        <Button variant="text" startIcon={<ArrowBackRoundedIcon />} href={backHref}>
          返回我的電子簽
        </Button>
      </Box>
      <PageHeader
        title={form.name}
        description={[
          form.docNumber,
          `建立人 ${form.createdBy.name}（${form.createdBy.employeeNo}）`,
          `${period.resign ? '補簽期限' : '簽署期限'} ${period.endAt ?? '不限'}`,
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
          {sheet ? (
            <SheetView sheet={sheet} rows={[{ no: rowNo, signer: me }]} highlight={me.id} />
          ) : (
            <ReadOnlyDocument form={form} me={me} />
          )}
        </>
      ) : sheet ? (
        <SheetSignFlow form={form} sheet={sheet} me={me} rowNo={rowNo} />
      ) : (
        <SignFlow form={form} me={me} today={todayStr()} />
      )}
    </>
  );
}
