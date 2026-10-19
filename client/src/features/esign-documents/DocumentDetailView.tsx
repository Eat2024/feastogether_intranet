'use client';

// 檢視頁（後端文件）：GET /api/esign/documents/:id 取得文件詳情與簽署人，GET .../history 取得簽署歷程。
// 簽署人清單的狀態分頁、搜尋、排序與分頁記在網址上，在瀏覽器端處理。
import { useGetDocumentQuery } from '@/api/queries';
import type { EsignDocumentDetail } from '@/api/types';
import LinkPagination from '@/components/LinkPagination';
import LinkTabs from '@/components/LinkTabs';
import PageHeader from '@/components/PageHeader';
import SearchField from '@/components/SearchField';
import { getErrorMessage } from '@/lib/apiError';
import { pageHrefs } from '@/lib/paginate';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import dayjs from 'dayjs';
import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import DocumentHistory from './DocumentHistory';
import DocumentSignerTable from './DocumentSignerTable';
import { DOCUMENT_STATUS_META, documentStatus, formatDate } from './listQuery';
import {
  countByStatus,
  nextSignerSort,
  parseSignerQuery,
  querySigners,
  SIGNER_SORT_KEYS,
  SIGNER_STATUS_TABS,
  signerHref,
  type SignerSortKey,
} from './signerQuery';
import StopDocumentButton from './StopDocumentButton';

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

export default function DocumentDetailView({ documentId }: { documentId: string }) {
  const { data: doc, isPending, isError, error, refetch, isFetching } = useGetDocumentQuery(documentId);

  if (isPending) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 8 }}>
        <CircularProgress size={20} />
        <Typography variant="description">載入文件中…</Typography>
      </Box>
    );
  }
  if (isError) {
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={() => refetch()} loading={isFetching}>
            重新載入
          </Button>
        }
      >
        無法取得文件：{getErrorMessage(error)}
      </Alert>
    );
  }
  // 草稿還沒有簽署進度，請改用「發起簽署」
  if (doc.status === 'draft') {
    return (
      <Alert severity="info" action={<Button href={`/forms/${doc.id}/signers`}>前往設定簽署</Button>}>
        「{doc.title}」尚未發起簽署，還沒有簽署進度可以檢視。
      </Alert>
    );
  }
  return <Detail doc={doc} />;
}

function Detail({ doc }: { doc: EsignDocumentDetail }) {
  const params = useSearchParams();
  const query = useMemo(() => parseSignerQuery(params), [params]);
  const status = documentStatus(doc);
  const statusMeta = DOCUMENT_STATUS_META[status];
  const counts = countByStatus(doc.signers);
  const { items, page, pageCount, total } = querySigners(doc.signers, query);
  const percent = counts.all ? Math.round((counts.signed / counts.all) * 100) : 0;

  const sortHrefs = Object.fromEntries(
    SIGNER_SORT_KEYS.map((key) => [key, signerHref(doc.id, query, { sort: nextSignerSort(query.sort, key) })]),
  ) as Record<SignerSortKey, string>;

  return (
    <>
      <PageHeader
        title={doc.title}
        description={[
          doc.docNumber,
          doc.createdBy && `建立人 ${doc.createdBy.name}（${doc.createdBy.employeeNo}）`,
          `簽署期間 ${formatDate(doc.signStartAt) ?? '—'} ～ ${formatDate(doc.signEndAt) ?? '不限'}`,
        ]
          .filter(Boolean)
          .join('・')}
        actions={
          <>
            {/* TODO: 串接 PATCH /api/esign/documents/:id 後開放（後端只允許修改草稿） */}
            <Tooltip title="尚未串接後端">
              <span>
                <Button size="large" variant="outlined" startIcon={<EditRoundedIcon />} disabled>
                  編輯
                </Button>
              </span>
            </Tooltip>
            {/* 簽署中（含已過結束時間仍有人未簽、顯示為已到期）才能停止 */}
            <StopDocumentButton doc={doc} variant="button" disabled={doc.status !== 'active'} />
          </>
        }
      />

      {doc.status === 'stopped' && (
        <Alert severity="error" variant="outlined">
          此文件已於 {doc.stoppedAt ? dayjs(doc.stoppedAt).format('YYYY/MM/DD HH:mm') : '—'} 停止簽署
          {doc.stopReason && `，原因：${doc.stopReason}`}。尚未簽署的人已無法再簽署。
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
        <Stack spacing={2}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="sectionTitle">簽署進度</Typography>
            <Chip size="small" variant="soft" label={statusMeta.label} color={statusMeta.color} />
          </Box>
          <Box sx={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            <Kpi label="總人數" value={counts.all} />
            <Kpi label="已簽署" value={counts.signed} color="success.dark" />
            <Kpi label="待簽署" value={counts.pending} color="warning.dark" />
            <Kpi label="已拒絕" value={counts.rejected} color="error.dark" />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <LinearProgress variant="determinate" value={percent} sx={{ flex: 1 }} />
            <Typography variant="secondary" component="span" sx={{ whiteSpace: 'nowrap' }}>
              {percent}% 已簽署
            </Typography>
          </Box>
        </Stack>
      </Paper>

      <Stack spacing={2}>
        <LinkTabs
          value={query.status}
          tabs={SIGNER_STATUS_TABS.map((t) => ({
            value: t.key,
            label: `${t.label}（${counts[t.key]}）`,
            // 切換狀態時保留搜尋與排序，回到第 1 頁
            href: signerHref(doc.id, query, { status: t.key }),
          }))}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          <SearchField placeholder="搜尋姓名、員工編號、Email 或部門" />
          <Typography variant="secondary" component="span" sx={{ flexShrink: 0 }}>
            共 {total} 筆
          </Typography>
        </Box>
        <DocumentSignerTable
          documentId={doc.id}
          fileNamePrefix={`${doc.docNumber}_${doc.title}`}
          canNotify={doc.status === 'active'}
          pendingTotal={counts.pending}
          rows={items}
          sort={query.sort}
          sortHrefs={sortHrefs}
          emptyText={query.q ? `找不到符合「${query.q}」的簽署人。` : '此分類沒有簽署人。'}
        />
        <LinkPagination page={page} hrefs={pageHrefs(pageCount, (p) => signerHref(doc.id, query, { page: p }))} />
      </Stack>

      <DocumentHistory documentId={doc.id} />
    </>
  );
}
