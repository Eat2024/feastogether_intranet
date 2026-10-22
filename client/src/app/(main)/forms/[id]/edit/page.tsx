import PageHeader from '@/components/PageHeader';
import StepFlow from '@/components/StepFlow';
import DocumentEditView from '@/features/esign-documents/DocumentEditView';
import { stepsOf } from '@/features/forms/editor/steps';
import SheetEditor from '@/features/forms/sheet/SheetEditor';
import { signedCount } from '@/features/forms/status';
import { getForm } from '@/features/forms/store';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { Box, Button } from '@mui/material';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const metadata: Metadata = { title: '編輯文件' };
export const dynamic = 'force-dynamic';

export default async function EditFormPage({
  params,
}: PageProps<'/forms/[id]/edit'>) {
  const { id } = await params;
  // 後端建立的文件（數字 id）：在瀏覽器端讀取草稿並修改
  if (/^\d+$/.test(id)) {
    return (
      <>
        <Box>
          <Button variant="text" startIcon={<ArrowBackRoundedIcon />} href="/forms">
            返回電子簽列表
          </Button>
        </Box>
        <DocumentEditView documentId={id} />
      </>
    );
  }

  // 其餘 id 為簽到表原型（mock store，後端尚未支援簽到表）
  const form = getForm(id);
  if (!form || form.docType !== 'sheet') notFound();

  const locked = signedCount(form) > 0 || form.status === 'stopped';
  const isDraft = form.status === 'draft';

  return (
    <>
      <Box>
        <Button
          variant="text"
          startIcon={<ArrowBackRoundedIcon />}
          href="/forms"
        >
          返回電子簽列表
        </Button>
      </Box>

      {/* 草稿仍在新增流程中，顯示步驟；已發起的文件只是編輯內容 */}
      {isDraft && <StepFlow steps={stepsOf(form.docType)} activeIndex={0} />}
      <PageHeader
        title="編輯文件"
        description={`「${form.name}」${form.docNumber ? `（${form.docNumber}）` : ''}－ 設定簽到表的表頭資訊。`}
      />
      <SheetEditor form={form} locked={locked} />
    </>
  );
}
