import FlashSnackbar from '@/components/FlashSnackbar';
import PageHeader from '@/components/PageHeader';
import SearchField from '@/components/SearchField';
import FormsTable from '@/features/forms/FormsTable';
import { filterForms, parseSort, sortForms } from '@/features/forms/sort';
import { getForms, toClientForm } from '@/features/forms/store';
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
  const query = typeof params.q === 'string' ? params.q.trim() : '';
  const forms = sortForms(filterForms(getForms(), query), sort);

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
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          <Suspense>
            <SearchField placeholder="搜尋文件名稱、文件編號或建立人" />
          </Suspense>
          <Typography variant="secondary" component="span" sx={{ flexShrink: 0 }}>
            共 {forms.length} 筆
          </Typography>
        </Box>
        <FormsTable forms={forms.map((f) => toClientForm(f))} sort={sort} query={query} />
      </Stack>
      <Suspense>
        <FlashSnackbar messages={FLASH_MESSAGES} />
      </Suspense>
    </>
  );
}
