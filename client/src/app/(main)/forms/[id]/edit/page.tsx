import PageHeader from '@/components/PageHeader';
import StepFlow from '@/components/StepFlow';
import UploadEditor from '@/features/forms/editor/UploadEditor';
import { stepsOf } from '@/features/forms/editor/steps';
import SheetEditor from '@/features/forms/sheet/SheetEditor';
import { signedCount } from '@/features/forms/status';
import { getDocument, toEditForm, type DocumentDetail } from '@/features/forms/serverApi';
import { getForm } from '@/features/forms/store';
import type { EFormDoc } from '@/features/forms/types';
import { EsignApiError } from '@/lib/api/esign';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { Box, Button } from '@mui/material';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const metadata: Metadata = { title: '編輯文件' };
export const dynamic = 'force-dynamic';

/** 後端文件轉成編輯頁的資料 */
async function loadDocumentForm(id: string): Promise<EFormDoc> {
  let document: DocumentDetail;
  try {
    document = await getDocument(id);
  } catch (error) {
    // 文件不存在、不是本人的文件（後端一律回 404）或 id 格式不正確
    if (error instanceof EsignApiError && (error.status === 404 || error.status === 400)) notFound();
    throw error;
  }
  return toEditForm(document);
}

export default async function EditFormPage({
  params,
}: PageProps<'/forms/[id]/edit'>) {
  const { id } = await params;
  // 簽到表與示意資料仍在 mock store；其餘為後端文件
  const mock = getForm(id);
  const form = mock ?? (await loadDocumentForm(id));

  // 後端文件發起後不可修改
  const locked = signedCount(form) > 0 || form.status === 'stopped' || (!mock && form.status !== 'draft');
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
        description={`「${form.name}」${form.docNumber ? `（${form.docNumber}）` : ''}－ ${
          form.docType === 'sheet' ? '設定簽到表的表頭資訊與空白列。' : '上傳 PDF 文件，逐頁預覽並指定簽名要落在哪裡。'
        }`}
      />
      {form.docType === 'sheet' ? <SheetEditor form={form} locked={locked} /> : <UploadEditor form={form} locked={locked} />}
    </>
  );
}
