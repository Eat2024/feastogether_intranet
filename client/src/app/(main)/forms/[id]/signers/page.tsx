import PageHeader from '@/components/PageHeader';
import StepFlow from '@/components/StepFlow';
import SignersEditor from '@/features/forms/editor/SignersEditor';
import { stepsOf } from '@/features/forms/editor/steps';
import { getOrgTree } from '@/features/forms/orgChart';
import { getDocument, toSignersEditorForm, type DocumentDetail } from '@/features/forms/serverApi';
import { getForm } from '@/features/forms/store';
import type { EFormDoc } from '@/features/forms/types';
import { EsignApiError } from '@/lib/api/esign';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { Box, Button } from '@mui/material';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = { title: '設定簽署' };
export const dynamic = 'force-dynamic';

/** 後端文件轉成設定簽署畫面的資料 */
async function loadDocumentForm(id: string): Promise<EFormDoc> {
  let document: DocumentDetail;
  try {
    document = await getDocument(id);
  } catch (error) {
    // 文件不存在、不是本人的文件（後端一律回 404）或 id 格式不正確
    if (error instanceof EsignApiError && (error.status === 404 || error.status === 400)) notFound();
    throw error;
  }
  // 已發起的文件不能再改簽署設定
  if (document.status !== 'draft') redirect('/forms');
  return toSignersEditorForm(document);
}

export default async function FormSignersPage({
  params,
}: PageProps<'/forms/[id]/signers'>) {
  const { id } = await params;
  // 簽到表與示意資料仍在 mock store；其餘為後端文件
  const form = getForm(id) ?? (await loadDocumentForm(id));
  // 已發起的文件不能再改簽署設定
  if (form.status !== 'draft') redirect('/forms');

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
      <StepFlow steps={stepsOf(form.docType)} activeIndex={1} />
      <PageHeader
        title="設定簽署"
        description={`「${form.name}」${form.docNumber ? `（${form.docNumber}）` : ''}－ 為此文件指定需簽署的人員，並設定簽署期間。`}
      />
      <SignersEditor form={form} org={getOrgTree()} />
    </>
  );
}
