import FlashSnackbar from '@/components/FlashSnackbar';
import LinkPagination from '@/components/LinkPagination';
import PageHeader from '@/components/PageHeader';
import { getCurrentUserId } from '@/features/forms/orgChart';
import { getForms, toSignerView } from '@/features/forms/store';
import MySignTable from '@/features/my-signature/MySignTable';
import MySignTabs from '@/features/my-signature/MySignTabs';
import { mySignHref, parseMySort, sortTasks } from '@/features/my-signature/sort';
import { listSigningTasks, toMySignTask } from '@/features/my-signature/serverApi';
import { collectMySignTasks, groupMySignTasks, parseTab } from '@/features/my-signature/tasks';
import { PAGE_SIZE, pageHrefs, paginate, parsePage } from '@/lib/paginate';
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
  const today = new Date();
  // 後端的簽署任務與 mock store 的文件一起整理分頁
  const apiTasks = (await listSigningTasks()).map((t) => toMySignTask(t, today));
  const allTasks = groupMySignTasks([...apiTasks, ...collectMySignTasks(getForms(), userId, today)]);
  const tasks = Object.fromEntries(
    Object.entries(allTasks).map(([tab, list]) => [
      tab,
      list.map((t) => {
        // me 也要用簽署人視角的資料（不含管理端備註，簽到表帶出序號）
        const form = toSignerView(t.form, t.me.id);
        return { ...t, form, me: form.signers[0] ?? t.me };
      }),
    ]),
  ) as typeof allTasks;
  const counts = {
    pending: tasks.pending.length,
    signed: tasks.signed.length,
    rejected: tasks.rejected.length,
  };

  const { items, page, pageCount } = paginate(sortTasks(tasks[tab], sort), parsePage(params.page), PAGE_SIZE);

  return (
    <>
      <PageHeader
        title="我的電子簽"
        hideTitleWhenEmbedded
        description="查看需要你簽署的文件，並追蹤已簽署與已拒絕的紀錄。"
      />
      <Stack spacing={2}>
        <MySignTabs value={tab} counts={counts} />
        <MySignTable tab={tab} tasks={items} today={new Date()} sort={sort} />
        <LinkPagination page={page} hrefs={pageHrefs(pageCount, (p) => mySignHref(tab, sort, p))} />
      </Stack>
      <Suspense>
        <FlashSnackbar messages={FLASH_MESSAGES} />
      </Suspense>
    </>
  );
}
