import LinkPagination from '@/components/LinkPagination';
import LinkTabs from '@/components/LinkTabs';
import PageHeader from '@/components/PageHeader';
import SearchField from '@/components/SearchField';
import SignerTable from '@/features/forms/detail/SignerTable';
import {
  countByStatus,
  nextSignerSort,
  parseSignerQuery,
  querySigners,
  signerHref,
  SIGNER_SORT_KEYS,
  STATUS_TABS,
} from '@/features/forms/detail/signerQuery';
import { getDeptName } from '@/features/forms/orgChart';
import { FORM_STATUS_META, getProgress, periodText, signedCount } from '@/features/forms/status';
import { formOptions } from '@/features/forms/options';
import StopSigningButton from '@/features/forms/StopSigningButton';
import { getForm, toClientForm } from '@/features/forms/store';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { pageHrefs } from '@/lib/paginate';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';

export const metadata: Metadata = { title: '文件簽署狀態' };
export const dynamic = 'force-dynamic';

function Kpi({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <Stack spacing={0.5} sx={{ minWidth: 96 }}>
      <Typography variant="label" component="span">
        {label}
      </Typography>
      <Typography variant="kpi" sx={color ? { color } : undefined}>
        {value}
      </Typography>
    </Stack>
  );
}

export default async function FormDetailPage({ params, searchParams }: PageProps<'/forms/[id]'>) {
  const { id } = await params;
  const stored = getForm(id);
  if (!stored) notFound();
  // 草稿尚無簽署進度，請改用「編輯」或「發起簽署」
  if (stored.status === 'draft') redirect('/forms');

  // 發起人檢視：簽名圖檔不需要傳給畫面
  const form = toClientForm(stored);
  const progress = getProgress(form);
  const options = formOptions(form);
  const statusMeta = FORM_STATUS_META[progress.status];
  const query = parseSignerQuery(await searchParams);
  const counts = countByStatus(form);
  const { rows, total, page, pageCount } = querySigners(form, query, getDeptName);
  const canEdit = signedCount(form) === 0 && form.status !== 'stopped';

  const sortHrefs = Object.fromEntries(
    SIGNER_SORT_KEYS.map((key) => [key, signerHref(id, query, { sort: nextSignerSort(query.sort, key) })]),
  ) as Record<(typeof SIGNER_SORT_KEYS)[number], string>;

  return (
    <>
      <Box>
        <Button variant="text" startIcon={<ArrowBackRoundedIcon />} href="/forms">
          返回電子簽列表
        </Button>
      </Box>

      <PageHeader
        title={form.name}
        description={[
          form.docNumber,
          `建立人 ${form.createdBy.name}（${form.createdBy.employeeNo}）`,
          `簽署期間 ${periodText(form)}`,
          // 可選功能：只列出與預設不同的設定
          options.watermark && '匯出文件加浮水印',
          !options.allowReject && '不開放拒絕簽署',
        ]
          .filter(Boolean)
          .join('・')}
        actions={
          <>
            <Button
              size="large"
              variant="outlined"
              startIcon={<EditRoundedIcon />}
              href={`/forms/${id}/edit`}
              disabled={!canEdit}
            >
              編輯
            </Button>
            <StopSigningButton form={form} variant="button" disabled={progress.status !== 'active'} />
          </>
        }
      />

      <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
        <Stack spacing={2}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="sectionTitle">簽署進度</Typography>
            <Chip size="small" variant="soft" label={statusMeta.label} color={statusMeta.color} />
          </Box>
          <Box sx={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            <Kpi label="總人數" value={progress.total} />
            <Kpi label="已簽署" value={progress.signed} color="success.dark" />
            <Kpi label="待簽署" value={progress.pending} color="warning.dark" />
            <Kpi label="已拒絕" value={progress.rejected} color="error.dark" />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <LinearProgress
              variant="determinate"
              value={progress.total ? (progress.signed / progress.total) * 100 : 0}
              sx={{ flex: 1 }}
            />
            <Typography variant="secondary" component="span" sx={{ whiteSpace: 'nowrap' }}>
              {progress.total ? Math.round((progress.signed / progress.total) * 100) : 0}% 已簽署
            </Typography>
          </Box>
        </Stack>
      </Paper>

      <Stack spacing={2}>
        <LinkTabs
          value={query.status}
          tabs={STATUS_TABS.map((t) => ({
            value: t.key,
            label: `${t.label}（${counts[t.key]}）`,
            // 切換狀態時保留搜尋與排序，回到第 1 頁
            href: signerHref(id, query, { status: t.key }),
          }))}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          <Suspense>
            <SearchField placeholder="搜尋姓名、員工編號或部門" />
          </Suspense>
          <Typography variant="secondary" component="span" sx={{ flexShrink: 0 }}>
            共 {total} 筆
          </Typography>
        </Box>
        <SignerTable
          formId={id}
          rows={rows}
          sort={query.sort}
          sortHrefs={sortHrefs}
          canNotify={progress.status === 'active'}
          pendingTotal={progress.pending}
          emptyText={query.q ? `找不到符合「${query.q}」的簽署人。` : '此分類沒有簽署人。'}
        />
        <LinkPagination
          page={page}
          hrefs={pageHrefs(pageCount, (p) => signerHref(id, query, { page: p }))}
        />
      </Stack>
    </>
  );
}
