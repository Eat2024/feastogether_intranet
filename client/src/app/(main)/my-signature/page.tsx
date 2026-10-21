import FlashSnackbar from '@/components/FlashSnackbar';
import PageHeader from '@/components/PageHeader';
import SigningTasksListView from '@/features/signing-tasks/SigningTasksListView';
import type { Metadata } from 'next';
import { Suspense } from 'react';

export const metadata: Metadata = { title: '我的電子簽' };

const FLASH_MESSAGES = {
  signed: '已完成簽署',
};

// 列表資料改由後端 GET /api/esign/signing-tasks 取得（SigningTasksListView，瀏覽器端呼叫）
export default function MySignaturePage() {
  return (
    <>
      <PageHeader
        title="我的電子簽"
        hideTitleWhenEmbedded
        description="查看需要你簽署的文件，並追蹤已簽署的紀錄。"
      />
      {/* useSearchParams 需要 Suspense 邊界 */}
      <Suspense>
        <SigningTasksListView />
      </Suspense>
      <Suspense>
        <FlashSnackbar messages={FLASH_MESSAGES} />
      </Suspense>
    </>
  );
}
