import FlashSnackbar from '@/components/FlashSnackbar';
import PageHeader from '@/components/PageHeader';
import FormsTable from '@/features/forms/FormsTable';
import { getForms } from '@/features/forms/store';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import Button from '@mui/material/Button';
import type { Metadata } from 'next';
import { Suspense } from 'react';

export const metadata: Metadata = { title: '電子簽列表' };

// 資料可被新增／修改，每次請求都重新讀取
export const dynamic = 'force-dynamic';

const FLASH_MESSAGES = {
  published: '已發起簽署，通知 {count} 位簽署人',
  saved: '已儲存簽署設定',
  updated: '文件已更新',
};

export default function FormsPage() {
  return (
    <>
      <PageHeader
        title="電子簽列表"
        description="建立內部電子簽文件、設定簽署人員並追蹤簽署進度；已有人簽署的文件將無法再修改內容。"
        actions={
          <Button
            size="large"
            variant="contained"
            startIcon={<AddRoundedIcon />}
            href="/forms/new"
          >
            新增電子簽文件
          </Button>
        }
      />
      <FormsTable forms={getForms()} />
      <Suspense>
        <FlashSnackbar messages={FLASH_MESSAGES} />
      </Suspense>
    </>
  );
}
