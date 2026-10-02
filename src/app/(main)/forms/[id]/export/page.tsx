import PageHeader from '@/components/PageHeader';
import { buildSignerDeptTree, selectedDeptKeys, signerDeptKey } from '@/features/forms/export/deptTree';
import ExportOptions from '@/features/forms/export/ExportOptions';
import {
  exportFileHref,
  exportRows,
  FIELDS,
  parseExportQuery,
  PREVIEW_ROWS,
} from '@/features/forms/export/exportQuery';
import { getDeptName } from '@/features/forms/orgChart';
import { FORM_STATUS_META, getProgress } from '@/features/forms/status';
import { getForm } from '@/features/forms/store';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = { title: '匯出簽署紀錄' };
export const dynamic = 'force-dynamic';

export default async function FormExportPage({ params, searchParams }: PageProps<'/forms/[id]/export'>) {
  const { id } = await params;
  const form = getForm(id);
  if (!form) notFound();
  // 草稿尚無簽署資料可匯出
  if (form.status === 'draft') redirect('/forms');

  const query = parseExportQuery(await searchParams);
  const deptTree = buildSignerDeptTree(form);
  const rows = exportRows(form, query, {
    deptOf: getDeptName,
    deptKeyOf: signerDeptKey,
    deptKeys: selectedDeptKeys(query.depts),
  });
  const fields = FIELDS.filter((f) => query.fields.includes(f.key));
  const progress = getProgress(form);
  const statusMeta = FORM_STATUS_META[progress.status];

  return (
    <>
      <Box>
        <Button variant="text" startIcon={<ArrowBackRoundedIcon />} href="/forms">
          返回電子簽列表
        </Button>
      </Box>

      <PageHeader
        title={`匯出「${form.name}」`}
        description={[
          form.docNumber,
          `簽署期間 ${form.startAt ?? '—'} ～ ${form.endAt ?? '不限'}`,
          `${statusMeta.label}（${progress.signed}/${progress.total} 已簽署）`,
        ]
          .filter(Boolean)
          .join('・')}
      />

      <Alert severity="warning" variant="outlined">
        匯出的檔案含姓名、員工編號、部門等個人資料，請妥善保管，勿任意轉傳。
      </Alert>

      <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
        <ExportOptions formId={id} query={query} deptTree={deptTree} />
      </Paper>

      <Stack spacing={1.5}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2 }}>
          <Typography variant="subheading" component="div">
            4. 預覽（前 {PREVIEW_ROWS} 筆）
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
                rows.slice(0, PREVIEW_ROWS).map((r) => (
                  <TableRow key={r.id}>
                    {fields.map((f) => (
                      <TableCell key={f.key} sx={{ whiteSpace: f.key === 'rejectReason' ? 'normal' : 'nowrap' }}>
                        {String(f.value(r)) || '—'}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Stack>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
        <Button size="large" variant="outlined" href="/forms">
          取消
        </Button>
        {/* 檔案下載用一般連結（不經 Next.js 前端路由） */}
        <Button
          size="large"
          variant="contained"
          startIcon={<FileDownloadRoundedIcon />}
          component="a"
          href={exportFileHref(id, query)}
          download
          disabled={rows.length === 0}
        >
          匯出 Excel（{rows.length} 筆）
        </Button>
      </Box>
    </>
  );
}
