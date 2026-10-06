import FlashSnackbar from '@/components/FlashSnackbar';
import LinkPagination from '@/components/LinkPagination';
import PageHeader from '@/components/PageHeader';
import SearchField from '@/components/SearchField';
import FormsFilterBar from '@/features/forms/FormsFilterBar';
import FormsTable from '@/features/forms/FormsTable';
import { filterForms, formsHref, parseFilters, parseSort, sortForms } from '@/features/forms/sort';
import { getForms, toClientForm } from '@/features/forms/store';
import { PAGE_SIZE, pageHrefs, paginate, parsePage } from '@/lib/paginate';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
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

export default async function FormsPage({ searchParams }: PageProps<'/forms'>) {
  const params = await searchParams;
  const sort = parseSort(params);
  const filters = parseFilters(params);
  const forms = sortForms(filterForms(getForms(), filters), sort);
  const { items, page, pageCount } = paginate(forms, parsePage(params.page), PAGE_SIZE);

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
      <Stack spacing={2}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, flex: 1, minWidth: 0 }}>
            <Suspense>
              <SearchField placeholder="搜尋文件名稱或建立人" width={260} />
              <FormsFilterBar statuses={filters.statuses} from={filters.from} to={filters.to} />
            </Suspense>
          </Box>
          <Typography variant="secondary" component="span" sx={{ flexShrink: 0 }}>
            共 {forms.length} 筆
          </Typography>
        </Box>
        <FormsTable forms={items.map((f) => toClientForm(f))} sort={sort} filters={filters} />
        <LinkPagination page={page} hrefs={pageHrefs(pageCount, (p) => formsHref({ filters, sort, page: p }))} />
      </Stack>
      <Suspense>
        <FlashSnackbar messages={FLASH_MESSAGES} />
      </Suspense>
    </>
  );
}
