import FlashSnackbar from '@/components/FlashSnackbar';
import PageHeader from '@/components/PageHeader';
import DocumentsListView from '@/features/esign-documents/DocumentsListView';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import Button from '@mui/material/Button';
import type { Metadata } from 'next';
import { Suspense } from 'react';

export const metadata: Metadata = { title: '電子簽列表' };

const FLASH_MESSAGES = {
  published: '已發起簽署，通知 {count} 位簽署人',
  saved: '已儲存簽署設定',
  draftSaved: '已儲存草稿設定',
  updated: '文件已更新',
};

// 列表資料改由後端 GET /api/esign/documents 取得（DocumentsListView，瀏覽器端呼叫）
export default function FormsPage() {
  return (
    <>
      {/* 嵌入入口網時隱藏標題與「新增電子簽文件」：入口網已有同名標題與「建立電子簽」選單 */}
      <PageHeader
        title="電子簽列表"
        hideTitleWhenEmbedded
        hideActionsWhenEmbedded
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
      {/* useSearchParams 需要 Suspense 邊界 */}
      <Suspense>
        <DocumentsListView />
      </Suspense>
      <Suspense>
        <FlashSnackbar messages={FLASH_MESSAGES} />
      </Suspense>
    </>
  );
}
