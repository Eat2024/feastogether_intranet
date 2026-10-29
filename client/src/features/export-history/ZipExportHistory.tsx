'use client';

// 歷史匯出文件的「已簽署文件 ZIP」分頁：GET /api/esign/exports（所有人申請的已簽署副本 ZIP 匯出紀錄，由新到舊）。
// 以 cursor 分頁；有紀錄還在處理中時每 5 秒更新。可下載、重試失敗的匯出，或重新產生已到期的 ZIP。
import { useGetExportHistoryQuery } from '@/api/queries';
import { queryKeys } from '@/api/query-keys';
import { documentExportFileUrl, requestDocumentExport, retryDocumentExport } from '@/api/requests';
import type { EsignExportHistoryItem, EsignExportStatus } from '@/api/types';
import { useSnackbar } from '@/components/providers/SnackbarProvider';
import TooltipIconButton from '@/components/TooltipIconButton';
import { formatDateTime } from '@/features/esign-documents/listQuery';
import { getErrorMessage } from '@/lib/apiError';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import FolderZipRoundedIcon from '@mui/icons-material/FolderZipRounded';
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
import { useState } from 'react';

const PAGE_SIZE = 20;

const STATUS_META: Record<EsignExportStatus, { label: string; color: ChipProps['color'] }> = {
  pending: { label: '排隊中', color: 'default' },
  waiting: { label: '等待副本產製', color: 'info' },
  processing: { label: '打包中', color: 'info' },
  completed: { label: '可下載', color: 'success' },
  failed: { label: '失敗', color: 'error' },
  expired: { label: '已到期', color: 'default' },
};

const IN_PROGRESS: EsignExportStatus[] = ['pending', 'waiting', 'processing'];

const COLUMNS = ['匯出時間', '文件名稱', '文件編號', '收錄份數', '狀態', '匯出人', '重新下載'];

/** 一筆紀錄的下載／重試／重新產生 */
function RecordAction({ record }: { record: EsignExportHistoryItem }) {
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_EXPORT_HISTORY] });
  const retry = useMutation({
    mutationFn: retryDocumentExport,
    meta: { suppressGlobalErrorToast: true },
    onSuccess: () => {
      refresh();
      showSnackbar('已重新受理匯出，完成後即可下載', 'success');
    },
    onError: (err) => showSnackbar(getErrorMessage(err, '重試失敗，請稍後再試'), 'error'),
  });
  const regenerate = useMutation({
    mutationFn: requestDocumentExport,
    meta: { suppressGlobalErrorToast: true },
    onSuccess: () => {
      refresh();
      showSnackbar('已受理重新產生 ZIP，完成後即可下載', 'success');
    },
    onError: (err) => showSnackbar(getErrorMessage(err, '重新產生失敗，請稍後再試'), 'error'),
  });

  const file = record.files[0];
  if (record.status === 'completed' && file) {
    // 檔案可能很大，以瀏覽器直接下載（支援續傳），不先讀進記憶體
    return (
      <TooltipIconButton
        label={`下載 ZIP（保存至 ${formatDateTime(record.expiresAt) ?? '—'}）`}
        icon={<FileDownloadRoundedIcon />}
        color="info"
        href={documentExportFileUrl(record.documentId, record.id, file.id)}
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
        onClick={() => retry.mutate({ id: record.documentId, exportId: record.id })}
      />
    );
  }
  if (record.status === 'expired') {
    return (
      <TooltipIconButton
        label="ZIP 已過保存期限，重新產生（收錄目前所有已簽署副本）"
        icon={<FolderZipRoundedIcon />}
        color="info"
        disabled={regenerate.isPending}
        onClick={() => regenerate.mutate(record.documentId)}
      />
    );
  }
  return (
    <Typography variant="helper" component="span">
      處理中
    </Typography>
  );
}

export default function ZipExportHistory() {
  // cursor 分頁：記錄已走過的頁面起點，才能回到上一頁
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const { data, isPending, isError, error, refetch, isFetching } = useGetExportHistoryQuery(
    { cursor: cursors.at(-1), limit: PAGE_SIZE },
    {
      // 有紀錄還在處理中時定期更新
      refetchInterval: (query) =>
        query.state.data?.items.some((r) => IN_PROGRESS.includes(r.status)) ? 5000 : false,
    },
  );

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
    <Typography variant="description">目前還沒有匯出紀錄。</Typography>
  ) : null;

  return (
    <Stack spacing={2}>
      <Typography variant="helper" component="div">
        每份文件的已簽署副本（每人一份 PDF）打包成一個 ZIP；ZIP 自完成起保存 7 天，期限內重複申請會沿用同一份。
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              {COLUMNS.map((c) => (
                <TableCell key={c}>{c}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {placeholder ? (
              <TableRow>
                <TableCell colSpan={COLUMNS.length} align="center" sx={{ py: 6 }}>
                  {placeholder}
                </TableCell>
              </TableRow>
            ) : (
              data?.items.map((r) => {
                const status = STATUS_META[r.status];
                return (
                  <TableRow key={r.id} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.snapshotAt) ?? '—'}</TableCell>
                    {/* TODO: 後端補上文件名稱與編號後移除以 id 代替的顯示 */}
                    <TableCell>{r.documentTitle ?? `文件 #${r.documentId}`}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.docNumber ?? '—'}</TableCell>
                    <TableCell>{r.expectedCount} 份</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Chip size="small" variant="soft" label={status.label} color={status.color} />
                      {r.status === 'completed' && r.expiresAt && (
                        <Typography variant="helper" component="div">
                          保存至 {formatDateTime(r.expiresAt)}
                        </Typography>
                      )}
                      {r.status === 'waiting' && (
                        <Typography variant="helper" component="div">
                          尚有 {r.waitingCount} 份副本產製中
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.requesterName || '—'}</TableCell>
                    <TableCell>
                      <RecordAction record={r} />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {(cursors.length > 1 || data?.nextCursor) && (
        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
          <Button disabled={cursors.length <= 1} onClick={() => setCursors((prev) => prev.slice(0, -1))}>
            較新的紀錄
          </Button>
          <Button
            disabled={!data?.nextCursor}
            onClick={() => data?.nextCursor && setCursors((prev) => [...prev, data.nextCursor ?? undefined])}
          >
            較早的紀錄
          </Button>
        </Box>
      )}
    </Stack>
  );
}
