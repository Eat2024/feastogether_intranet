import FlashSnackbar from '@/components/FlashSnackbar';
import PageHeader from '@/components/PageHeader';
import { getCurrentUserId } from '@/features/forms/orgChart';
import { getForms, toSignerView } from '@/features/forms/store';
import MySignTable from '@/features/my-signature/MySignTable';
import MySignTabs from '@/features/my-signature/MySignTabs';
import { parseMySort, sortTasks } from '@/features/my-signature/sort';
import { getMySignTasks, parseTab } from '@/features/my-signature/tasks';
import Stack from '@mui/material/Stack';
import type { Metadata } from 'next';
import { Suspense } from 'react';

export const metadata: Metadata = { title: '我的電子簽' };

const FLASH_MESSAGES = {
  signed: '已完成簽署',
  rejected: '已拒絕簽署',
};

export default async function MySignaturePage({ searchParams }: PageProps<'/my-signature'>) {
  const params = await searchParams;
  const tab = parseTab(params.tab);
  const sort = parseMySort(params, tab);
  // 以完整資料計算進度與可否簽署，再只保留本人的紀錄傳給畫面（不外流其他簽署人）
  const userId = getCurrentUserId();
  const allTasks = getMySignTasks(getForms(), userId, new Date());
  const tasks = Object.fromEntries(
    Object.entries(allTasks).map(([tab, list]) => [
      tab,
      list.map((t) => ({ ...t, form: toSignerView(t.form, userId) })),
    ]),
  ) as typeof allTasks;
  const counts = {
    pending: tasks.pending.length,
    signed: tasks.signed.length,
    rejected: tasks.rejected.length,
  };

  return (
    <>
      <PageHeader
        title="我的電子簽"
        description="查看需要你簽署的文件，並追蹤已簽署與已拒絕的紀錄。"
      />
      <Stack spacing={2}>
        <MySignTabs value={tab} counts={counts} />
        <MySignTable tab={tab} tasks={sortTasks(tasks[tab], sort)} today={new Date()} sort={sort} />
      </Stack>
      <Suspense>
        <FlashSnackbar messages={FLASH_MESSAGES} />
      </Suspense>
    </>
  );
}
