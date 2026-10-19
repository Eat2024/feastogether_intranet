'use client';

// 匯出簽署紀錄（後端文件）：畫面與 mock 版 /forms/[id]/export 相同，條件記在網址上。
// 後端沒有匯出 API，以 GET /api/esign/documents/:id 的簽署人在瀏覽器端產生 Excel。
import { useGetDocumentQuery } from '@/api/queries';
import type { EsignDocumentDetail, EsignSignerStatus } from '@/api/types';
import LinkPagination from '@/components/LinkPagination';
import PageHeader from '@/components/PageHeader';
import { useSnackbar } from '@/components/providers/SnackbarProvider';
import DeptTreeSelect from '@/features/forms/export/DeptTreeSelect';
import { getErrorMessage } from '@/lib/apiError';
import { PAGE_SIZE, pageHrefs, paginate, parsePage } from '@/lib/paginate';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMutation } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useTransition, type ReactNode } from 'react';
import {
  buildDeptOptions,
  exportPageHref,
  exportRows,
  FIELDS,
  parseExportQuery,
  selectedDeptNames,
  STATUS_OPTIONS,
  type ExportQuery,
  type FieldKey,
} from './exportQuery';
import { DOCUMENT_STATUS_META, documentStatus, formatDate } from './listQuery';

const UNSUPPORTED = '後端尚未支援';

const CONTENT_TYPES = [
  { key: 'list', label: '簽署紀錄清單（Excel）', description: '每位簽署人一列，可選擇欄位與範圍。', enabled: true },
  {
    key: 'docs',
    label: '已簽署文件（PDF，每人一份打包為 ZIP）',
    description: `${UNSUPPORTED}，之後提供。`,
    enabled: false,
  },
];

function Section({ step, title, children }: { step: number; title: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="subheading" component="div" sx={{ mb: 1 }}>
        {step}. {title}
      </Typography>
      {children}
    </Box>
  );
}

/** 後端沒有資料的欄位標示 */
const UnsupportedChip = () => (
  <Tooltip title={`${UNSUPPORTED}，匯出為空白`}>
    <Chip size="small" variant="outlined" label="未支援" sx={{ ml: 0.5, height: 20, fontSize: 11, color: 'text.secondary' }} />
  </Tooltip>
);

export default function DocumentExportView({ documentId }: { documentId: string }) {
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
  // 草稿尚無簽署資料可匯出
  if (doc.status === 'draft') {
    return (
      <Alert severity="info" action={<Button href={`/forms/${doc.id}/signers`}>前往設定簽署</Button>}>
        「{doc.title}」尚未發起簽署，還沒有簽署資料可以匯出。
      </Alert>
    );
  }
  return <ExportPage doc={doc} />;
}

function ExportPage({ doc }: { doc: EsignDocumentDetail }) {
  const router = useRouter();
  const params = useSearchParams();
  const { showSnackbar } = useSnackbar();
  const [, startTransition] = useTransition();
  const query = useMemo(() => parseExportQuery(params), [params]);
  const deptOptions = useMemo(() => buildDeptOptions(doc.signers), [doc.signers]);
  const rows = useMemo(() => exportRows(doc.signers, query), [doc.signers, query]);
  const preview = paginate(rows, parsePage(params.get('page') ?? undefined), PAGE_SIZE);
  const fields = FIELDS.filter((f) => query.fields.includes(f.key));
  const status = documentStatus(doc);
  const signed = doc.signers.filter((s) => s.status === 'signed').length;

  const update = (change: Partial<ExportQuery>) =>
    startTransition(() => router.replace(exportPageHref(doc.id, { ...query, ...change }), { scroll: false }));

  const allStatuses = query.statuses.length === 0;
  const toggleStatus = (key: EsignSignerStatus) => {
    const next = query.statuses.includes(key) ? query.statuses.filter((s) => s !== key) : [...query.statuses, key];
    // 三種都勾等同全部
    update({ statuses: next.length === STATUS_OPTIONS.length ? [] : next });
  };
  const toggleField = (key: FieldKey) => {
    const next = query.fields.includes(key) ? query.fields.filter((f) => f !== key) : [...query.fields, key];
    if (next.length === 0) return; // 至少保留一個欄位
    update({ fields: FIELDS.filter((f) => next.includes(f.key)).map((f) => f.key) });
  };

  const download = useMutation({
    mutationFn: async () => {
      // exceljs 較大，點擊時才載入
      const { buildExportXlsx } = await import('./buildExportXlsx');
      const { blob, fileName } = await buildExportXlsx(doc, query, rows, selectedDeptNames(query.depts, deptOptions));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    },
    meta: { suppressGlobalErrorToast: true },
    onError: () => showSnackbar('匯出失敗，請稍後再試', 'error'),
  });

  return (
    <>
      <PageHeader
        title={`匯出「${doc.title}」`}
        description={[
          doc.docNumber,
          `簽署期間 ${formatDate(doc.signStartAt) ?? '—'} ～ ${formatDate(doc.signEndAt) ?? '不限'}`,
          `${DOCUMENT_STATUS_META[status].label}（${signed}/${doc.signers.length} 已簽署）`,
        ].join('・')}
      />

      <Alert severity="warning" variant="outlined">
        匯出的檔案含姓名、員工編號、部門等個人資料，請妥善保管，勿任意轉傳。
      </Alert>

      <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
        <Stack spacing={3}>
          <Section step={1} title="選擇匯出內容">
            <RadioGroup value="list">
              {CONTENT_TYPES.map((t) => (
                <FormControlLabel
                  key={t.key}
                  value={t.key}
                  disabled={!t.enabled}
                  control={<Radio />}
                  label={
                    <Box>
                      <Typography variant="content" component="span">
                        {t.label}
                      </Typography>{' '}
                      <Typography variant="helper">{t.description}</Typography>
                    </Box>
                  }
                />
              ))}
            </RadioGroup>
          </Section>

          <Section step={2} title="匯出範圍">
            <Stack spacing={1.5}>
              <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1 }}>
                <Typography variant="label" component="span" sx={{ width: 72 }}>
                  簽署狀態
                </Typography>
                <FormControlLabel
                  control={<Checkbox size="small" checked={allStatuses} onChange={() => update({ statuses: [] })} />}
                  label={<Typography variant="content">全部</Typography>}
                />
                {STATUS_OPTIONS.map((o) => (
                  <FormControlLabel
                    key={o.key}
                    control={
                      <Checkbox
                        size="small"
                        checked={!allStatuses && query.statuses.includes(o.key)}
                        onChange={() => toggleStatus(o.key)}
                      />
                    }
                    label={<Typography variant="content">{o.label}</Typography>}
                  />
                ))}
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', columnGap: 1 }}>
                <Typography variant="label" component="span" sx={{ width: 72, flexShrink: 0, pt: 1.25 }}>
                  部門
                </Typography>
                <DeptTreeSelect tree={deptOptions} value={query.depts} onChange={(depts) => update({ depts })} />
              </Box>
            </Stack>
          </Section>

          <Section step={3} title="匯出欄位">
            <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2 }}>
              {FIELDS.map((f) => (
                <FormControlLabel
                  key={f.key}
                  control={
                    <Checkbox size="small" checked={query.fields.includes(f.key)} onChange={() => toggleField(f.key)} />
                  }
                  label={
                    <Typography variant="content" component="span" sx={{ display: 'inline-flex', alignItems: 'center' }}>
                      {f.label}
                      {'unsupported' in f && <UnsupportedChip />}
                    </Typography>
                  }
                />
              ))}
            </Box>
          </Section>
        </Stack>
      </Paper>

      <Stack spacing={1.5}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2 }}>
          <Typography variant="subheading" component="div">
            4. 預覽
          </Typography>
          <Typography variant="secondary" component="span">
            將匯出 {rows.length} 筆
          </Typography>
        </Box>
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                {fields.map((f) => (
                  <TableCell key={f.key}>{f.label}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={fields.length} align="center" sx={{ py: 4 }}>
                    <Typography variant="description">此範圍沒有可匯出的簽署人。</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                preview.items.map((r) => (
                  <TableRow key={r.publicId}>
                    {fields.map((f) => (
                      <TableCell key={f.key} sx={{ whiteSpace: f.key === 'rejectReason' ? 'normal' : 'nowrap' }}>
                        {f.value(r) || '—'}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <LinkPagination
          page={preview.page}
          hrefs={pageHrefs(preview.pageCount, (p) => exportPageHref(doc.id, query, p))}
        />
      </Stack>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
        <Button size="large" variant="outlined" href="/forms">
          取消
        </Button>
        <Button
          size="large"
          variant="contained"
          startIcon={<FileDownloadRoundedIcon />}
          onClick={() => download.mutate()}
          loading={download.isPending}
          disabled={rows.length === 0}
        >
          匯出 Excel（{rows.length} 筆）
        </Button>
      </Box>
    </>
  );
}
