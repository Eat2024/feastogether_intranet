'use client';

// 我的電子簽（後端資料）：GET /api/esign/signing-tasks 取得指派給目前員工的簽署任務，
// 分頁標籤、排序與分頁記在網址上，在瀏覽器端處理。
import { useGetSigningTasksQuery } from '@/api/queries';
import LinkPagination from '@/components/LinkPagination';
import LinkTabs from '@/components/LinkTabs';
import { getErrorMessage } from '@/lib/apiError';
import { PAGE_SIZE, pageHrefs, paginate, parsePage } from '@/lib/paginate';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import SigningTasksTable from './SigningTasksTable';
import { parseSigningSort, parseSigningTab, SIGNING_TABS, signingHref, sortTasks, splitTasks, type SigningTab } from './taskQuery';

const EMPTY_TEXT: Record<SigningTab, string> = {
  pending: '目前沒有待簽署的文件。',
  signed: '目前沒有已簽署的文件。',
  rejected: '目前沒有已拒絕的文件。',
};

export default function SigningTasksListView() {
  const params = useSearchParams();
  const tab = parseSigningTab(params.get('tab'));
  const sort = useMemo(() => parseSigningSort(params, tab), [params, tab]);
  // 以進入頁面的時間判斷是否逾期、可否簽署（簽署頁會再以最新時間判斷）
  const [now] = useState(() => new Date());
  const { data, isPending, isError, error, refetch, isFetching } = useGetSigningTasksQuery();

  const byTab = useMemo(() => splitTasks(data ?? []), [data]);
  const { items, page, pageCount } = paginate(
    sortTasks(byTab[tab], sort),
    parsePage(params.get('page') ?? undefined),
    PAGE_SIZE,
  );

  // 沒有資料列時表格內顯示的內容
  const placeholder = isPending ? (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}>
      <CircularProgress size={20} />
      <Typography variant="description">載入文件中…</Typography>
    </Box>
  ) : isError ? (
    <Stack spacing={1.5} sx={{ alignItems: 'center' }}>
      <Typography variant="description">無法取得簽署任務：{getErrorMessage(error)}</Typography>
      <Button variant="outlined" onClick={() => refetch()} loading={isFetching}>
        重新載入
      </Button>
    </Stack>
  ) : items.length === 0 ? (
    <Typography variant="description">{EMPTY_TEXT[tab]}</Typography>
  ) : null;

  return (
    <Stack spacing={2}>
      <LinkTabs
        value={tab}
        tabs={SIGNING_TABS.map((t) => ({
          value: t.key,
          label: data ? `${t.label}（${byTab[t.key].length}）` : t.label,
          href: `?tab=${t.key}`,
        }))}
      />
      <SigningTasksTable tab={tab} tasks={items} sort={sort} now={now} placeholder={placeholder} />
      <LinkPagination page={page} hrefs={pageHrefs(pageCount, (p) => signingHref(tab, sort, p))} />
    </Stack>
  );
}
