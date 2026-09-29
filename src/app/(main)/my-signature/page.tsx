import PageHeader from '@/components/PageHeader';
import { CURRENT_USER_ID, MOCK_FORMS } from '@/features/forms/mock';
import MySignTable from '@/features/my-signature/MySignTable';
import MySignTabs from '@/features/my-signature/MySignTabs';
import { getMySignTasks, parseTab } from '@/features/my-signature/tasks';
import Stack from '@mui/material/Stack';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: '我的電子簽' };

export default async function MySignaturePage({ searchParams }: PageProps<'/my-signature'>) {
  const tab = parseTab((await searchParams).tab);
  const tasks = getMySignTasks(MOCK_FORMS, CURRENT_USER_ID);
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
        <MySignTable tab={tab} tasks={tasks[tab]} today={new Date()} />
      </Stack>
    </>
  );
}
