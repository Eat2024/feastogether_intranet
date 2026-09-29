import PageHeader from '@/components/PageHeader';
import StepFlow from '@/components/StepFlow';
import UploadEditor from '@/features/forms/editor/UploadEditor';
import { CREATE_STEPS } from '@/features/forms/editor/steps';
import { signedCount } from '@/features/forms/status';
import { getForm } from '@/features/forms/store';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const metadata: Metadata = { title: '編輯文件' };
export const dynamic = 'force-dynamic';

export default async function EditFormPage({ params }: PageProps<'/forms/[id]/edit'>) {
  const form = getForm((await params).id);
  if (!form) notFound();

  const locked = signedCount(form) > 0 || form.status === 'stopped';
  const isDraft = form.status === 'draft';

  return (
    <>
      {/* 草稿仍在新增流程中，顯示步驟；已發起的文件只是編輯內容 */}
      {isDraft && <StepFlow steps={CREATE_STEPS} activeIndex={0} />}
      <PageHeader
        title="編輯文件"
        description={`「${form.name}」${form.docNumber ? `（${form.docNumber}）` : ''}－ 上傳 Word／PDF 文件，逐頁預覽並指定簽名要落在哪裡。`}
      />
      <UploadEditor form={form} locked={locked} />
    </>
  );
}
