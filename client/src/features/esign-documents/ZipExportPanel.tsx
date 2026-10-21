'use client';

// 匯出頁的「已簽署文件 ZIP」：POST /api/esign/documents/:id/exports 受理後由後端背景打包，
// 以 GET .../exports/:exportId 查詢進度，完成後以瀏覽器直接下載（檔案可能很大，不先讀進記憶體）。
// 進入頁面時以 GET /api/esign/exports?documentId= 帶回這份文件最近一次的匯出。
import { useGetDocumentExportQuery, useGetExportHistoryQuery } from '@/api/queries';
import { queryKeys } from '@/api/query-keys';
import { documentExportFileUrl, requestDocumentExport, retryDocumentExport } from '@/api/requests';
import type { EsignExportJob } from '@/api/types';
import { useSnackbar } from '@/components/providers/SnackbarProvider';
import { getErrorMessage } from '@/lib/apiError';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import FolderZipRoundedIcon from '@mui/icons-material/FolderZipRounded';
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { formatDateTime } from './listQuery';

/** 檔案大小：KB／MB 顯示 */
function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const IN_PROGRESS: EsignExportJob['status'][] = ['pending', 'waiting', 'processing'];

export default function ZipExportPanel({ documentId, signedCount }: { documentId: string; signedCount: number }) {
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();
  // 這份文件最近一次的匯出（進入頁面時帶回）；按下產生後改看新的匯出工作
  const latest = useGetExportHistoryQuery({ documentId, limit: 1 });
  const [requestedId, setRequestedId] = useState<string | null>(null);
  const exportId = requestedId ?? latest.data?.items[0]?.id ?? null;
  const job = useGetDocumentExportQuery(documentId, exportId);

  const onJob = (next: EsignExportJob) => {
    setRequestedId(next.id);
    queryClient.setQueryData([queryKeys.ESIGN_DOCUMENT_EXPORT, documentId, next.id], next);
    void queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_EXPORT_HISTORY] });
  };
  const request = useMutation({
    mutationFn: requestDocumentExport,
    meta: { suppressGlobalErrorToast: true },
    onSuccess: (result) => {
      onJob(result);
      if (result.reused && result.status === 'completed') showSnackbar('已有可下載的 ZIP，沿用上次產生的檔案', 'info');
    },
    onError: (err) => showSnackbar(getErrorMessage(err, '產生 ZIP 失敗，請稍後再試'), 'error'),
  });
  const retry = useMutation({
    mutationFn: retryDocumentExport,
    meta: { suppressGlobalErrorToast: true },
    onSuccess: onJob,
    onError: (err) => showSnackbar(getErrorMessage(err, '重試失敗，請稍後再試'), 'error'),
  });

  const data = job.data;
  const busy = request.isPending || retry.isPending;
  const generateButton = (label: string) => (
    <Button
      size="large"
      variant="contained"
      startIcon={<FolderZipRoundedIcon />}
      loading={request.isPending}
      disabled={busy || signedCount === 0}
      onClick={() => request.mutate(documentId)}
    >
      {label}
    </Button>
  );

  return (
    <Stack spacing={2}>
      <Typography variant="description">
        每位已簽署者一份個人簽署副本（PDF），打包成一個 ZIP。範圍為產生當下所有已簽署的副本，不套用狀態、部門等篩選。
      </Typography>

      {(latest.isPending && !requestedId) || (exportId && job.isPending) ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 2 }}>
          <CircularProgress size={20} />
          <Typography variant="description">讀取匯出狀態中…</Typography>
        </Box>
      ) : job.isError ? (
        <Alert severity="error">無法取得匯出狀態：{getErrorMessage(job.error)}</Alert>
      ) : !data ? (
        // 還沒產生過
        <Box>
          {signedCount === 0 ? (
            <Alert severity="info" variant="outlined">
              目前還沒有人完成簽署，沒有可匯出的已簽署文件。
            </Alert>
          ) : (
            generateButton(`產生 ZIP（${signedCount} 份已簽署）`)
          )}
        </Box>
      ) : IN_PROGRESS.includes(data.status) ? (
        <Stack spacing={1}>
          <Typography variant="content">
            {data.status === 'waiting'
              ? `正在等待 ${data.waitingCount} 份個人副本產製完成…`
              : data.status === 'processing'
                ? '正在打包…'
                : '排隊中，即將開始打包…'}
          </Typography>
          <LinearProgress
            variant={data.expectedCount ? 'determinate' : 'indeterminate'}
            value={data.expectedCount ? (data.processedCount / data.expectedCount) * 100 : 0}
          />
          <Typography variant="helper">
            已處理 {data.processedCount}／{data.expectedCount} 份；完成後即可在此下載，可以先離開此頁。
          </Typography>
        </Stack>
      ) : data.status === 'completed' ? (
        <Stack spacing={1.5}>
          {data.files.map((f) => (
            <Box key={f.id} sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <Box sx={{ mr: 'auto' }}>
                <Typography variant="content" component="div">
                  {f.fileName}
                </Typography>
                <Typography variant="helper" component="div">
                  {data.expectedCount} 份・{formatSize(f.size)}・{formatDateTime(data.snapshotAt) ?? '—'} 的簽署資料
                  {data.expiresAt && `・保存至 ${formatDateTime(data.expiresAt)}`}
                </Typography>
              </Box>
              {/* 直接以瀏覽器下載：檔案可能很大，且支援續傳 */}
              <Button
                size="large"
                variant="contained"
                startIcon={<FileDownloadRoundedIcon />}
                href={documentExportFileUrl(documentId, data.id, f.id)}
                download
              >
                下載 ZIP
              </Button>
            </Box>
          ))}
          {signedCount > data.expectedCount && (
            // 後端在保存期限內一律沿用同一份 ZIP，過期後重新產生才會包含之後簽署的人
            <Alert severity="info" variant="outlined">
              產生之後又有 {signedCount - data.expectedCount} 人完成簽署，目前的 ZIP 沒有包含；保存期限過後重新產生即會包含。
            </Alert>
          )}
        </Stack>
      ) : data.status === 'failed' ? (
        <Alert
          severity="error"
          action={
            // 文件完整性錯誤無法重試
            data.failureCode !== 'ESIGN_INTEGRITY_FAILED' && (
              <Button
                color="inherit"
                size="small"
                startIcon={<ReplayRoundedIcon />}
                loading={retry.isPending}
                disabled={busy}
                onClick={() => retry.mutate({ id: documentId, exportId: data.id })}
              >
                重試
              </Button>
            )
          }
        >
          {data.failureCode === 'ESIGN_INTEGRITY_FAILED'
            ? 'ZIP 產生失敗：文件驗證未通過，請聯絡系統管理員。'
            : 'ZIP 產生失敗，請重試。'}
        </Alert>
      ) : (
        // expired：檔案已過保存期限
        <Alert severity="info" variant="outlined" action={generateButton('重新產生')}>
          上次產生的 ZIP 已過保存期限（{formatDateTime(data.expiresAt) ?? '—'}），請重新產生。
        </Alert>
      )}
    </Stack>
  );
}
