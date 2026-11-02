'use client';

// 我的電子簽（後端資料）：GET /api/esign/signing-tasks 取得指派給目前員工的簽署任務，
// 搜尋、分頁標籤、排序與分頁記在網址上，在瀏覽器端處理。
import { useGetSigningTasksQuery } from '@/api/queries';
import LinkPagination from '@/components/LinkPagination';
import LinkTabs from '@/components/LinkTabs';
import SearchField from '@/components/SearchField';
import { getErrorMessage } from '@/lib/apiError';
import { PAGE_SIZE, pageHrefs, paginate, parsePage } from '@/lib/paginate';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import SigningTasksTable from './SigningTasksTable';
import {
  filterTasks,
  parseSigningSort,
  parseSigningTab,
  SIGNING_TABS,
  signingHref,
  sortTasks,
  splitTasks,
  type SigningTab,
} from './taskQuery';

const EMPTY_TEXT: Record<SigningTab, string> = {
  pending: '目前沒有待簽署的文件。',
  signed: '目前沒有已簽署的文件。',
  rejected: '目前沒有已拒絕的文件。',
};

export default function SigningTasksListView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = parseSigningTab(params.get('tab'));
  const sort = useMemo(() => parseSigningSort(params, tab), [params, tab]);
  const query = (params.get('q') ?? '').trim();
  // 以進入頁面的時間判斷是否逾期、可否簽署（簽署頁會再以最新時間判斷）
  const [now] = useState(() => new Date());
  const { data, isPending, isError, error, refetch, isFetching } = useGetSigningTasksQuery();

  // 先套用搜尋，分頁標籤的筆數也是搜尋結果
  const byTab = useMemo(() => splitTasks(filterTasks(data ?? [], query)), [data, query]);
  const { items, page, pageCount } = paginate(
    sortTasks(byTab[tab], sort),
    parsePage(params.get('page') ?? undefined),
    PAGE_SIZE,
  );

  // 等資料載入後才導正超頁，避免載入期間把有效的深連結頁碼改成第一頁。
  useEffect(() => {
    if (!data || isError) return;
    const canonicalPage = page > 1 ? String(page) : null;
    if (params.get('page') === canonicalPage && params.getAll('page').length <= 1) return;
    const qs = new URLSearchParams(params);
    qs.delete('page');
    if (canonicalPage) qs.set('page', canonicalPage);
    const queryString = qs.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }, [data, isError, page, params, pathname, router]);

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
    <Typography variant="description">
      {query ? `找不到符合「${query}」的文件，請換個關鍵字試試。` : EMPTY_TEXT[tab]}
    </Typography>
  ) : null;

  return (
    <Stack spacing={2}>
      <SearchField placeholder="搜尋文件名稱、文件編號或建立人" width={320} />
      <LinkTabs
        value={tab}
        tabs={SIGNING_TABS.map((t) => ({
          value: t.key,
          label: data ? `${t.label}（${byTab[t.key].length}）` : t.label,
          href: signingHref(t.key, null, 1, query),
        }))}
      />
      <SigningTasksTable tab={tab} tasks={items} sort={sort} query={query} now={now} placeholder={placeholder} />
      <LinkPagination page={page} hrefs={pageHrefs(pageCount, (p) => signingHref(tab, sort, p, query))} />
    </Stack>
  );
}
