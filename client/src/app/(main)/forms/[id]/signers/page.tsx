import PageHeader from '@/components/PageHeader';
import StepFlow from '@/components/StepFlow';
import SignersEditor from '@/features/forms/editor/SignersEditor';
import { CREATE_STEPS } from '@/features/forms/editor/steps';
import { getOrgTree } from '@/features/forms/orgChart';
import { getForm } from '@/features/forms/store';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { Box, Button } from '@mui/material';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = { title: '設定簽署' };
export const dynamic = 'force-dynamic';

export default async function FormSignersPage({
  params,
}: PageProps<'/forms/[id]/signers'>) {
  const form = getForm((await params).id);
  if (!form) notFound();
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
      <StepFlow steps={CREATE_STEPS} activeIndex={1} />
      <PageHeader
        title="設定簽署"
        description={`「${form.name}」${form.docNumber ? `（${form.docNumber}）` : ''}－ 為此文件指定需簽署的人員，並設定簽署期間。`}
      />
      <SignersEditor form={form} org={getOrgTree()} />
    </>
  );
}
