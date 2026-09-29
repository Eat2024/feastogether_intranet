import PageHeader from '@/components/PageHeader';
import StepFlow from '@/components/StepFlow';
import UploadEditor from '@/features/forms/editor/UploadEditor';
import { CREATE_STEPS } from '@/features/forms/editor/steps';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: '新增電子簽文件' };

export default function NewFormPage() {
  return (
    <>
      <PageHeader
        title="新增電子簽文件"
        description="上傳 Word／PDF 文件，逐頁預覽並指定簽名要落在哪裡。"
      />
      <StepFlow steps={CREATE_STEPS} activeIndex={0} />
      <UploadEditor />
    </>
  );
}
