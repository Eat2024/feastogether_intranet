'use client';

// 歷史匯出文件：GET /api/esign/history/export（Spec 015，所有人的匯出紀錄，依匯出時間由新到舊）。
// 依類型分頁標籤（Excel／PDF／ZIP），頁碼分頁；類型、頁碼與搜尋記在網址參數 tab、page、q。
// 簽到表後端尚未完成，分頁先隱藏。
import { useGetExportHistoryQuery } from '@/api/queries';
import { queryKeys } from '@/api/query-keys';
import {
  documentExportFileUrl,
  getExcelExportDocument,
  redownloadPdfExport,
  retryDocumentExport,
} from '@/api/requests';
import type {
  EsignExportStatus,
  ExcelExportHistoryItem,
  ExportHistoryItemByType,
  ExportHistoryType,
  PdfExportHistoryItem,
  ZipExportHistoryItem,
} from '@/api/types';
import LinkPagination from '@/components/LinkPagination';
import LinkTabs from '@/components/LinkTabs';
import SearchField from '@/components/SearchField';
import { useSnackbar } from '@/components/providers/SnackbarProvider';
import TooltipIconButton from '@/components/TooltipIconButton';
import { formatDateTime } from '@/features/esign-documents/listQuery';
import { buildDeptOptions, exportRows, selectedDeptNames } from '@/features/esign-documents/exportQuery';
import { getErrorMessage } from '@/lib/apiError';
import { PAGE_SIZE, pageHrefs, parsePage } from '@/lib/paginate';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip, { type ChipProps } from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

type HistoryTab = ExportHistoryType | 'sheet';

// TODO: 後端完成簽到表後改為 true 並串接 API
const SHEET_ENABLED = false;

const TABS: { value: HistoryTab; label: string }[] = [
  { value: 'excel', label: '簽署紀錄清單 Excel' },
  { value: 'pdf', label: '已簽署文件 PDF' },
  { value: 'zip', label: '已簽署文件 ZIP' },
  ...(SHEET_ENABLED ? [{ value: 'sheet' as const, label: '簽到表 PDF（尚未完成）' }] : []),
];

const historyHref = (tab: HistoryTab, page = 1, query = '') => {
  const qs = new URLSearchParams();
  if (query) qs.set('q', query);
  if (tab !== 'excel') qs.set('tab', tab);
  if (page > 1) qs.set('page', String(page));
  const s = qs.toString();
  return s ? `/export-history?${s}` : '/export-history';
};

const ZIP_STATUS_META: Record<EsignExportStatus, { label: string; color: ChipProps['color'] }> = {
  pending: { label: '排隊中', color: 'default' },
  waiting: { label: '等待副本產製', color: 'info' },
  processing: { label: '打包中', color: 'info' },
  completed: { label: '可下載', color: 'success' },
  failed: { label: '失敗', color: 'error' },
  expired: { label: '檔案已不可用', color: 'default' },
};

const ZIP_IN_PROGRESS: EsignExportStatus[] = ['pending', 'waiting', 'processing'];

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** ZIP 重試或重新產生後更新工作狀態與列表 */
function useRefreshHistory() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_EXPORT_HISTORY] });
}

/** Excel：依原條件與文件目前資料重新產生，不新增歷史紀錄 */
function ExcelRedownload({ record }: { record: ExcelExportHistoryItem }) {
  const { showSnackbar } = useSnackbar();
  const download = useMutation({
    mutationFn: async () => {
      // exceljs 較大，點擊時才載入
      const [doc, { buildExportXlsx }] = await Promise.all([
        getExcelExportDocument(record.id),
        import('@/features/esign-documents/buildExportXlsx'),
      ]);
      const rows = exportRows(doc.signers, record.conditions);
      const deptNames = selectedDeptNames(record.conditions.depts, buildDeptOptions(doc.signers));
      const { blob, fileName } = await buildExportXlsx(doc, record.conditions, rows, deptNames);
      saveBlob(blob, fileName);
    },
    meta: { suppressGlobalErrorToast: true },
    onError: (err) => showSnackbar(getErrorMessage(err, '下載失敗，請稍後再試'), 'error'),
  });
  return (
    <TooltipIconButton
      label={download.isPending ? '下載中…' : '依當時條件以目前資料重新產生'}
      icon={<FileDownloadRoundedIcon />}
      color="info"
      disabled={download.isPending}
      onClick={() => download.mutate()}
    />
  );
}

/** PDF：下載該簽署人目前的已簽署副本，不新增歷史紀錄 */
function PdfRedownload({ record }: { record: PdfExportHistoryItem }) {
  const { showSnackbar } = useSnackbar();
  const download = useMutation({
    mutationFn: () => redownloadPdfExport(record.id),
    meta: { suppressGlobalErrorToast: true },
    onSuccess: ({ bytes, fileName }) => {
      saveBlob(bytes, fileName);
    },
    onError: (err) => showSnackbar(getErrorMessage(err, '下載失敗，請稍後再試'), 'error'),
  });
  return (
    <TooltipIconButton
      label={download.isPending ? '下載中…' : '重新下載'}
      icon={<FileDownloadRoundedIcon />}
      color="info"
      disabled={download.isPending}
      onClick={() => download.mutate()}
    />
  );
}

/** ZIP：下載或重試尚未成功的匯出；舊不可用成果不重新產生。 */
function ZipAction({ record }: { record: ZipExportHistoryItem }) {
  const { showSnackbar } = useSnackbar();
  const refresh = useRefreshHistory();
  const retry = useMutation({
    mutationFn: retryDocumentExport,
    meta: { suppressGlobalErrorToast: true },
    onSuccess: () => {
      refresh();
      showSnackbar('已重新受理匯出，完成後即可下載', 'success');
    },
    onError: (err) => showSnackbar(getErrorMessage(err, '重試失敗，請稍後再試'), 'error'),
  });


  const file = record.files[0];
  if (record.status === 'completed' && file) {
    // 檔案可能很大，以瀏覽器直接下載（支援續傳），不先讀進記憶體
    return (
      <TooltipIconButton
        label="下載 ZIP"
        icon={<FileDownloadRoundedIcon />}
        color="info"
        href={documentExportFileUrl(record.document.id, record.id, file.id)}
      />
    );
  }
  if (record.status === 'failed') {
    // 文件完整性錯誤無法重試
    const canRetry = record.failureCode !== 'ESIGN_INTEGRITY_FAILED';
    return (
      <TooltipIconButton
        label={canRetry ? '重試匯出' : '無法重試：文件驗證未通過，請聯絡系統管理員'}
        icon={<ReplayRoundedIcon />}
        color="info"
        disabled={!canRetry || retry.isPending}
        onClick={() => retry.mutate({ id: record.document.id, exportId: record.id })}
      />
    );
  }
  if (record.status === 'expired') {
    return <Typography variant="helper">檔案已不可用</Typography>;
  }
  return (
    <Typography variant="helper" component="span">
      處理中
    </Typography>
  );
}

/** 各類型不同的欄位：表頭與每列的儲存格 */
type ColumnSet<T extends ExportHistoryType> = {
  head: string[];
  cells: (r: ExportHistoryItemByType[T]) => ReactNode;
};

const COLUMN_SETS: { [T in ExportHistoryType]: ColumnSet<T> } = {
  excel: {
    head: ['匯出範圍', '筆數'],
    cells: (r) => (
      <>
        <TableCell sx={{ minWidth: 200 }}>{r.scope}</TableCell>
        <TableCell>{r.count}</TableCell>
      </>
    ),
  },
  pdf: {
    head: ['簽署人'],
    cells: (r) => <TableCell sx={{ minWidth: 200 }}>{r.scope}</TableCell>,
  },
  zip: {
    head: ['收錄份數', '狀態'],
    cells: (r) => {
      const status = ZIP_STATUS_META[r.status];
      return (
        <>
          <TableCell>{r.count} 份</TableCell>
          <TableCell sx={{ whiteSpace: 'nowrap' }}>
            <Chip size="small" variant="soft" label={status.label} color={status.color} />
            {r.status === 'waiting' && (
              <Typography variant="helper" component="div">
                尚有 {r.waitingCount} 份副本產製中
              </Typography>
            )}
          </TableCell>
        </>
      );
    },
  },
};

function RecordAction({ record }: { record: ExportHistoryItemByType[ExportHistoryType] }) {
  if (record.type === 'excel') return <ExcelRedownload record={record} />;
  if (record.type === 'pdf') return <PdfRedownload record={record} />;
  return <ZipAction record={record} />;
}

export default function ExportHistoryView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tabParam = params.get('tab');
  const type: ExportHistoryType = tabParam === 'pdf' || tabParam === 'zip' ? tabParam : 'excel';
  const requestedPage = parsePage(params.get('page') ?? undefined);
  const query = (params.get('q') ?? '').trim();
  const { data, isPending, isError, error, refetch, isFetching } = useGetExportHistoryQuery(
    { type, q: query || undefined, page: requestedPage, pageSize: PAGE_SIZE },
    {
      // ZIP 有紀錄還在處理中時定期更新
      refetchInterval: (query) =>
        query.state.data?.items.some((r) => r.type === 'zip' && ZIP_IN_PROGRESS.includes(r.status)) ? 5000 : false,
    },
  );

  const page = data?.page ?? requestedPage;
  // 等待目前條件的回應，再以後端有效頁碼導正網址；保留關鍵字與其他條件。
  useEffect(() => {
    if (!data || isError) return;
    const canonicalPage = data.page > 1 ? String(data.page) : null;
    if (params.get('page') === canonicalPage && params.getAll('page').length <= 1) return;
    const qs = new URLSearchParams(params);
    qs.delete('page');
    if (canonicalPage) qs.set('page', canonicalPage);
    const queryString = qs.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }, [data, isError, params, pathname, router]);

  const columns = COLUMN_SETS[type] as ColumnSet<ExportHistoryType>;
  const head = ['匯出時間', '文件名稱', '文件編號', ...columns.head, '匯出人', '重新下載'];
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const placeholder = isPending ? (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}>
      <CircularProgress size={20} />
      <Typography variant="description">載入匯出紀錄中…</Typography>
    </Box>
  ) : isError ? (
    <Stack spacing={1.5} sx={{ alignItems: 'center' }}>
      <Typography variant="description">無法取得匯出紀錄：{getErrorMessage(error)}</Typography>
      <Button variant="outlined" onClick={() => refetch()} loading={isFetching}>
        重新載入
      </Button>
    </Stack>
  ) : data.items.length === 0 ? (
    <Typography variant="description">{query ? `找不到符合「${query}」的匯出紀錄。` : '目前還沒有匯出紀錄。'}</Typography>
  ) : null;

  return (
    <Stack spacing={2}>
      <SearchField placeholder="搜尋文件名稱、文件編號或建立人" width={320} />
      <LinkTabs
        value={type}
        tabs={TABS.map((t) => ({
          value: t.value,
          label: t.value !== 'sheet' && data ? `${t.label}（${data.typeTotals[t.value]}）` : t.label,
          href: historyHref(t.value, 1, query),
        }))}
      />
      {type === 'zip' && (
        <Typography variant="helper" component="div">
          每份文件的已簽署副本（每人一份 PDF）打包成一個 ZIP；ZIP 產生後持續保留並沿用同一份，不包含後續新增的簽署。
        </Typography>
      )}
      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              {head.map((c) => (
                <TableCell key={c}>{c}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {placeholder ? (
              <TableRow>
                <TableCell colSpan={head.length} align="center" sx={{ py: 6 }}>
                  {placeholder}
                </TableCell>
              </TableRow>
            ) : (
              data?.items.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.exportedAt)}</TableCell>
                  <TableCell>{r.document.title}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.document.docNumber}</TableCell>
                  {columns.cells(r)}
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Typography variant="content">{r.exportedBy.name}</Typography>
                    <Typography variant="helper">{r.exportedBy.employeeNo ?? r.exportedBy.email}</Typography>
                  </TableCell>
                  <TableCell>
                    <RecordAction record={r} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <LinkPagination page={page} hrefs={pageHrefs(pageCount, (p) => historyHref(type, p, query))} />
    </Stack>
  );
}
