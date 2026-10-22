import PageHeader from '@/components/PageHeader';
import { getCurrentUserId } from '@/features/forms/orgChart';
import SheetView from '@/features/forms/sheet/SheetView';
import { signingPeriod } from '@/features/forms/status';
import { getForm, toSignerView } from '@/features/forms/store';
import DownloadSignedCopyButton from '@/features/my-signature/sign/DownloadSignedCopyButton';
import { getSignBlock } from '@/features/my-signature/sign/eligibility';
import SheetSignFlow from '@/features/my-signature/sign/SheetSignFlow';
import SigningTaskView from '@/features/signing-tasks/SigningTaskView';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const metadata: Metadata = { title: '簽署文件' };
export const dynamic = 'force-dynamic';

// 後端簽署任務的 signerPublicId 為 UUID；其餘 id 為簽到表原型（mock store，後端尚未支援簽到表）
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SignDocumentPage({
  params,
}: PageProps<'/my-signature/[id]'>) {
  const { id } = await params;
  // 後端簽署任務：在瀏覽器端以使用者的 session 讀取任務並簽署
  if (UUID.test(id)) return <SigningTaskView signerPublicId={id} />;

  const stored = getForm(id);
  const userId = getCurrentUserId();
  if (!stored || stored.status === 'draft' || stored.docType !== 'sheet' || !stored.sheet) notFound();
  const storedMe = stored.signers.find((s) => s.id === userId);
  // 不是簽署人就當作不存在，不透露文件資訊
  if (!storedMe) notFound();

  // 以完整資料判斷可否簽署，再只把本人的紀錄傳給畫面（不外流其他簽署人）
  const block = getSignBlock(stored, storedMe, new Date());
  const form = toSignerView(stored, userId);
  const me = form.signers[0] ?? storedMe;
  const period = signingPeriod(form);
  const sheet = stored.sheet;
  const rowNo = me.rowNo ?? 1;

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
          <SheetView sheet={sheet} rows={[{ no: rowNo, signer: me }]} highlight={me.id} />
        </>
      ) : (
        <SheetSignFlow form={form} sheet={sheet} me={me} rowNo={rowNo} />
      )}
    </>
  );
}
