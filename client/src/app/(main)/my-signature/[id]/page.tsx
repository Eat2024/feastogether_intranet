import PageHeader from '@/components/PageHeader';
import { getCurrentUserId, getStaff } from '@/features/forms/orgChart';
import { remainingWalkIns, walkInSigner } from '@/features/forms/sheet/rules';
import SheetView from '@/features/forms/sheet/SheetView';
import { signingPeriod } from '@/features/forms/status';
import { getForm, toSignerView, todayStr } from '@/features/forms/store';
import DownloadSignedCopyButton from '@/features/my-signature/sign/DownloadSignedCopyButton';
import { getSignBlock } from '@/features/my-signature/sign/eligibility';
import ReadOnlyDocument from '@/features/my-signature/sign/ReadOnlyDocument';
import SheetSignFlow from '@/features/my-signature/sign/SheetSignFlow';
import SignFlow from '@/features/my-signature/sign/SignFlow';
import { getSigningTask, sourcePageCount, toMySignTask } from '@/features/my-signature/serverApi';
import type { EFormDoc, SheetInfo, Signer } from '@/features/forms/types';
import Alert from '@mui/material/Alert';
import type { Metadata } from 'next';
import { notFound, unstable_rethrow } from 'next/navigation';

export const metadata: Metadata = { title: '簽署文件' };
export const dynamic = 'force-dynamic';

type SignView = {
  form: EFormDoc;
  me: Signer;
  block: string | null;
  sheet?: SheetInfo;
  rowNo: number;
  /** 後端簽署任務：伺服器提供的電子簽名告知 */
  terms?: { version: string; items: string[] };
};

/** mock store 的文件 */
function mockView(stored: EFormDoc): SignView {
  const userId = getCurrentUserId();
  if (stored.status === 'draft') notFound();
  let storedMe = stored.signers.find((s) => s.id === userId);
  // 簽到表還有空白列時，名單外的同仁可透過簽到連結使用空白列簽到
  if (!storedMe && stored.docType === 'sheet' && remainingWalkIns(stored) > 0) {
    const staff = getStaff(userId);
    if (staff) storedMe = walkInSigner(staff);
  }
  // 不是簽署人就當作不存在，不透露文件資訊
  if (!storedMe) notFound();

  // 以完整資料判斷可否簽署，再只把本人的紀錄傳給畫面（不外流其他簽署人）
  const block = getSignBlock(stored, storedMe, new Date());
  const form = toSignerView(stored, userId);
  const me = form.signers[0] ?? storedMe;
  const sheet = stored.docType === 'sheet' ? stored.sheet : undefined;
  // 名單外人員的序號為下一個空白列
  const rowNo = sheet ? (me.rowNo ?? stored.signers.length + 1) : 0;
  return { form, me, block, sheet, rowNo };
}

const SIGNER_PUBLIC_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 後端簽署任務（id 為 signerPublicId） */
async function apiView(id: string): Promise<SignView> {
  if (!SIGNER_PUBLIC_ID.test(id)) notFound();
  const task = await getSigningTask(id);
  // 不是本人的任務就當作不存在，不透露文件資訊
  if (!task) notFound();
  // 頁數以原始 PDF 計算；無法讀取原始檔時（例如已停止）改以欄位所在頁推估
  const pageCount = await sourcePageCount(id).catch((error: unknown) => { unstable_rethrow(error); return undefined; });
  const t = toMySignTask(task, new Date(), pageCount);
  const form = toSignerView(t.form, t.me.id);
  return {
    form,
    me: form.signers[0] ?? t.me,
    block: t.signBlock,
    rowNo: 0,
    terms: { version: task.consent.version, items: [task.consent.text] },
  };
}

export default async function SignDocumentPage({
  params,
}: PageProps<'/my-signature/[id]'>) {
  const { id } = await params;
  const stored = getForm(id);
  const { form, me, block, sheet, rowNo, terms } = stored ? mockView(stored) : await apiView(id);
  const period = signingPeriod(form);

  return (
    <>
      <PageHeader
        title={form.name}
        description={[
          form.docNumber,
          `發起人 ${form.createdBy.name}（${form.createdBy.employeeNo}）`,
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
        <SignFlow form={form} me={me} today={todayStr()} terms={terms} />
      )}
    </>
  );
}
