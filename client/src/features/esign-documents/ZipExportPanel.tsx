'use client';

// 匯出頁的「已簽署文件 ZIP」：POST /api/esign/documents/:id/exports 受理後由後端背景打包，
// 以 GET .../exports/:exportId 查詢進度，完成後以瀏覽器直接下載（檔案可能很大，不先讀進記憶體）。
// 進入頁面時使用文件詳情的 exportSummary，與後端固定沿用的工作一致。
import { useGetDocumentExportQuery } from '@/api/queries';
import { queryKeys } from '@/api/query-keys';
import { prepareExportDownload, preparedExportFileUrl, requestDocumentExport, retryDocumentExport } from '@/api/requests';
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

/** ZIP 匯出的狀態與動作；「產生 ZIP」按鈕放在頁面底部操作列，與 Excel 的匯出按鈕同一位置，所以由頁面呼叫後傳給面板 */
export function useZipExport(documentId: string, exportSummary: EsignExportJob | null) {
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();
  // 詳情已選定固定工作；首次申請後改用回傳的工作。
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
  const busy = request.isPending || retry.isPending || download.isPending;
  // 還沒產生過（沒有固定沿用的工作）才可產生
  const canGenerate = !exportId;
  return { documentId, exportId, job, data, request, retry, download, busy, canGenerate };
}

export type ZipExport = ReturnType<typeof useZipExport>;

/** 底部操作列的 ZIP 按鈕（與 Excel 的匯出按鈕同一位置）：還沒產生過顯示「產生 ZIP」，完成後顯示「下載 ZIP」 */
export function ZipActionButtons({ zip, signedCount, fileName }: { zip: ZipExport; signedCount: number; fileName: string }) {
  const { data, busy } = zip;
  if (zip.canGenerate) {
    return (
      <Button
        size="large"
        variant="contained"
        startIcon={<FolderZipRoundedIcon />}
        loading={zip.request.isPending}
        disabled={busy || signedCount === 0}
        onClick={() => zip.request.mutate(zip.documentId)}
      >
        產生 ZIP（{signedCount} 份已簽署）
      </Button>
    );
  }
  if (zip.job.isError || data?.status !== 'completed') return null;
  // 直接以瀏覽器下載：檔案可能很大，且支援續傳
  return data.files.map((f, index) => (
    <Button
      key={f.id}
      size="large"
      variant="contained"
      startIcon={<FileDownloadRoundedIcon />}
      loading={zip.download.isPending && zip.download.variables?.fileId === f.id}
      disabled={busy}
      onClick={() => zip.download.mutate({ exportId: data.id, fileId: f.id, fileName })}
    >
      {data.files.length > 1 ? `下載 ZIP（${index + 1}/${data.files.length}）` : '下載 ZIP'}
    </Button>
  ));
}

export default function ZipExportPanel({ zip, signedCount, fileName = '' }: { zip: ZipExport; signedCount: number; fileName?: string }) {
  const { documentId, exportId, job, data, retry, busy } = zip;
  // 預覽本次下載名稱；實際下載仍由後端驗證並回傳最終檔名。
  const requestedFileName = fileName.trim();
  const downloadFileName = requestedFileName
    ? `${requestedFileName.replace(/\.(xlsx|zip)$/i, '')}.zip`
    : null;
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
        // 還沒產生過；產生按鈕在頁面底部操作列
        signedCount === 0 && (
          <Alert severity="info" variant="outlined">
            目前還沒有人完成簽署，沒有可匯出的已簽署文件。
          </Alert>
        )
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
            已處理 {data.processedCount}／{data.expectedCount} 份；完成後即可下載，可以先離開此頁。
          </Typography>
        </Stack>
      ) : data.status === 'completed' ? (
        <Stack spacing={1.5}>
          {data.files.map((f) => (
            // 下載按鈕在頁面底部操作列
            <Box key={f.id}>
              <Typography variant="content" component="div">
                {downloadFileName ?? f.fileName}
              </Typography>
              <Typography variant="helper" component="div">
                {data.expectedCount} 份・{formatSize(f.size)}・{formatDateTime(data.snapshotAt) ?? '—'} 的簽署資料
              </Typography>
            </Box>
          ))}
          {signedCount > data.expectedCount && (
            // ZIP 產生後固定沿用，不納入後續簽署。
            <Alert severity="info" variant="outlined">
              產生之後又有 {signedCount - data.expectedCount} 人完成簽署，目前的 ZIP 沒有包含，後續下載仍沿用這份檔案。
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
        // 舊 expired 紀錄不自動重建。
        <Alert severity="info" variant="outlined">
          檔案已不可用，請聯絡系統管理員。
        </Alert>
      )}
    </Stack>
  );
}
