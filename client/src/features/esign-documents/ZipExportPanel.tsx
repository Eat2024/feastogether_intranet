'use client';

// 匯出頁的「已簽署文件 ZIP」：POST /api/esign/documents/:id/exports 受理後由後端背景打包，
// 以 GET .../exports/:exportId 查詢進度，完成後以瀏覽器直接下載（檔案可能很大，不先讀進記憶體）。
// 目前成果與進行中的工作分開；只有明確要求更新才申請新工作。
import { useGetDocumentExportQuery } from '@/api/queries';
import { queryKeys } from '@/api/query-keys';
import { prepareExportDownload, preparedExportFileUrl, requestDocumentExport, retryDocumentExport } from '@/api/requests';
import type { EsignExportJob, EsignExportState } from '@/api/types';
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
import { useEffect, useState } from 'react';
import { formatDateTime } from './listQuery';

/** 檔案大小：KB／MB 顯示 */
function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const IN_PROGRESS: EsignExportJob['status'][] = ['pending', 'waiting', 'processing'];

export default function ZipExportPanel({ documentId, signedCount, exportState, fileName = '' }: { fileName?: string; documentId: string; signedCount: number; exportState: EsignExportState }) {
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();
  const exportSummary = exportState.work ?? exportState.current;
  // 使用者受理的工作固定追蹤，不因新增簽署自動重做。
  const [requestedId, setRequestedId] = useState<string | null>(null);
  const exportId = requestedId ?? exportSummary?.id ?? null;
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

  const download = useMutation({
    mutationFn: async (input: { exportId: string; fileId: string; fileName: string }) => {
      const prepared = await prepareExportDownload(documentId, { type: 'zip', ...input });
      const link = document.createElement('a');
      link.href = preparedExportFileUrl(prepared.downloadPath);
      link.download = prepared.fileName;
      link.target = '_blank';
      link.rel = 'noopener';
      link.click();
    },
    meta: { suppressGlobalErrorToast: true },
    onError: (err) => showSnackbar(getErrorMessage(err, '準備下載失敗，請稍後再試'), 'error'),
  });

  const data = job.data ?? exportSummary;
  const current = exportState.current;
  const newCount = data?.id === current?.id
    ? exportState.currentNewSignatureCount
    : data?.id === exportState.work?.id ? exportState.workNewSignatureCount : 0;
  const status = job.data?.status;
  useEffect(() => {
    if (!status || IN_PROGRESS.includes(status)) return;
    void queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_DOCUMENT_EXPORT_PREVIEW, documentId] });
    void queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_DOCUMENT, documentId] });
    void queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_EXPORT_HISTORY] });
  }, [status, exportId, documentId, queryClient]);
  // 預覽本次下載名稱；實際下載仍由後端驗證並回傳最終檔名。
  const requestedFileName = fileName.trim();
  const downloadFileName = requestedFileName
    ? `${requestedFileName.replace(/\.(xlsx|zip)$/i, '')}.zip`
    : null;
  const busy = request.isPending || retry.isPending || download.isPending;
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

  const renderFiles = (result: EsignExportJob, label: string) => (
    <Stack spacing={1.5}>
          {result.files.map((f) => (
            <Box key={f.id} sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <Box sx={{ mr: 'auto' }}>
                <Typography variant="content" component="div">
                  {downloadFileName ?? f.fileName}
                </Typography>
                <Typography variant="helper" component="div">
                  {result.expectedCount} 份・{formatSize(f.size)}・{formatDateTime(result.snapshotAt) ?? '—'} 的簽署資料
                </Typography>
              </Box>
              {/* 直接以瀏覽器下載：檔案可能很大，且支援續傳 */}
              <Button
                size="large"
                variant="contained"
                startIcon={<FileDownloadRoundedIcon />}
                loading={download.isPending}
                disabled={busy}
                onClick={() => download.mutate({ exportId: result.id, fileId: f.id, fileName })}
              >
                {label}
              </Button>
            </Box>
          ))}
    </Stack>
  );

  return (
    <Stack spacing={2}>
      <Typography variant="description">
        每位已簽署者一份個人簽署副本（PDF），打包成一個 ZIP。範圍為產生當下所有已簽署的副本，不套用狀態、部門等篩選。
      </Typography>

      {exportId && job.isPending ? (
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
          {renderFiles(data, requestedId ? '下載本次成果' : '下載 ZIP')}
          {newCount > 0 && (
            <Stack spacing={1}>
              <Alert severity="info" variant="outlined">
                目前 ZIP 共 {data.expectedCount} 份，另有 {newCount} 份新簽署尚未包含。
              </Alert>
              <Box>{generateButton('更新並下載 ZIP')}</Box>
            </Stack>
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
        <Alert severity="info" variant="outlined">
          檔案已不可用，請聯絡系統管理員。
        </Alert>
      )}
      {current?.status === 'completed' && data?.id !== current.id && data &&
        (IN_PROGRESS.includes(data.status) || data.status === 'failed') && (
          <Stack spacing={1}>
            <Alert severity="info" variant="outlined">
              更新完成前仍可下載舊版 ZIP（{current.expectedCount} 份），尚有 {exportState.currentNewSignatureCount} 份新簽署未包含。
            </Alert>
            {renderFiles(current, '下載舊版 ZIP')}
          </Stack>
        )}
    </Stack>
  );
}
