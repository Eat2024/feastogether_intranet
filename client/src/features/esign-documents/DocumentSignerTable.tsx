'use client';

// 檢視頁（後端文件）的簽署人清單：本頁資料已在外層篩選、排序、分頁。
// 拒簽、備註與外部催簽均來自正式 API。
// 外部簽署人的邀請信寄送結果顯示在「通知紀錄」，個人副本產製狀態顯示在操作欄的匯出按鈕。
import SingleReminderButton from './SingleReminderButton';
import NotificationHistory from './NotificationHistory';
import { notificationStatuses, notificationTime } from './notificationLabels';
import { useGetNotificationBatchQuery } from '@/api/queries';
import type { EsignSignerStatus, EsignSignerView, EsignManagedSignerView, EsignDocumentDetail } from '@/api/types';
import { queryKeys } from '@/api/query-keys';
import { downloadSignerCompletedFile, saveSignerNote, createNotificationBatch } from '@/api/requests';
import SortableHeaderCell from '@/components/SortableHeaderCell';
import { useSnackbar } from '@/components/providers/SnackbarProvider';
import TooltipIconButton from '@/components/TooltipIconButton';
import SignerNoteCell from '@/features/forms/detail/SignerNoteCell';
import { normalizeSignerNote } from '@/features/forms/detail/signerNote';
import { getErrorMessage } from '@/lib/apiError';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded';
import ReportProblemRoundedIcon from '@mui/icons-material/ReportProblemRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip, { type ChipProps } from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { type ReactNode, useState, useRef, useEffect } from 'react';
import type { SignerSort, SignerSortKey } from './signerQuery';

const STATUS_META: Record<EsignSignerStatus, { label: string; color: ChipProps['color'] }> = {
  pending: { label: '待簽署', color: 'warning' },
  signed: { label: '已簽署', color: 'success' },
  rejected: { label: '已拒絕', color: 'error' },
};

/** 外部簽署人的邀請信寄送結果 */
const DELIVERY_LABEL: Record<NonNullable<EsignSignerView['invitationDelivery']>, string> = {
  pending: '邀請信寄送中',
  delivered: '邀請信已寄出',
  failed: '邀請信寄送失敗',
};

/** 個人簽署副本尚未可下載時的原因（匯出按鈕的提示） */
const COMPLETION_HINT: Record<NonNullable<EsignSignerView['completion']['status']>, string> = {
  pending: '個人副本等待產製',
  processing: '個人副本產製中',
  ready: '',
  failed: '個人副本產製失敗',
};

/** unsupported：後端沒有這項資料，表頭加上標示（chip 與說明可自訂） */
const COLUMNS: {
  key?: SignerSortKey;
  label: string;
  unsupported?: { chip: string; hint: string };
}[] = [
  { key: 'name', label: '簽署人' },
  { key: 'dept', label: '部門' },
  { key: 'status', label: '狀態' },
  { key: 'time', label: '簽署／拒絕時間' },
  { label: '拒絕原因' },
  { label: '通知紀錄' },
  { label: '備註' },
  { label: '操作' },
];

const formatTime = (iso: string | null) => (iso ? dayjs(iso).format('YYYY/MM/DD HH:mm') : '—');

/** 表頭文字加上「未支援」等標示 */
function UnsupportedLabel({ children, chip, hint }: { children: ReactNode; chip: string; hint: string }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
      <Tooltip title={hint}>
        <Chip size="small" variant="outlined" label={chip} sx={{ height: 20, fontSize: 11, color: 'text.secondary' }} />
      </Tooltip>
    </Box>
  );
}

/** 後端未支援的儲存格 */
const NoData = () => <Typography sx={{ color: 'text.disabled' }}>—</Typography>;

/** 停用並說明原因的按鈕（停用的按鈕不觸發滑鼠事件，外包 span 讓 Tooltip 仍可顯示） */
export default function DocumentSignerTable({
  documentId,
  fileNamePrefix,
  rows,
  sort,
  sortHrefs,
  canNotify,
  eligibleExternalIds,
  emptyText,
}: {
  documentId: string;
  /** 匯出檔名的前綴（文件編號與名稱） */
  fileNamePrefix: string;
  rows: EsignManagedSignerView[];
  sort: SignerSort;
  /** 各欄點擊後的排序網址 */
  sortHrefs: Record<SignerSortKey, string>;
  /** 文件為簽署中時顯示通知列 */
  canNotify: boolean;
  /** 完整名單中符合催簽資格的外部識別（跨頁） */
  eligibleExternalIds: string[];
  emptyText: string;
}) {
  const { showSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const selectedEligible = selected.filter((id) => eligibleExternalIds.includes(id));
  const pageEligible = rows.filter((s) => s.type === 'email' && s.reminderEligibility?.eligible).map((s) => s.publicId);
  const [batchId, setBatchId] = useState<string | null>(null);
  const lastRequest = useRef<{ key: string; requestId: string } | null>(null);
  const batch = useGetNotificationBatchQuery(documentId, batchId);
  const notify = useMutation({
    mutationFn: (selection: 'selected' | 'all_pending') => {
      const ids = selection === 'selected' ? [...selectedEligible].sort() : undefined;
      const key = JSON.stringify({ selection, ids });
      if (lastRequest.current?.key !== key) lastRequest.current = { key, requestId: crypto.randomUUID() };
      return createNotificationBatch(documentId, {
        requestId: lastRequest.current.requestId,
        selection,
        signerPublicIds: ids,
      });
    },
    onSuccess: (result) => {
      lastRequest.current = null;
      setSelected([]);
      setBatchId(result.batchId);
      showSnackbar(
        `已受理 ${result.queuedCount} 人催簽，${result.notSentCount} 人未寄出；可於通知歷史查看結果`,
        'success',
      );
      void queryClient.invalidateQueries({
        queryKey: [queryKeys.ESIGN_NOTIFICATION_BATCHES, documentId],
      });
      void queryClient.invalidateQueries({
        queryKey: [queryKeys.ESIGN_DOCUMENT, documentId],
      });
    },
    onError: () => {
      void queryClient.invalidateQueries({
        queryKey: [queryKeys.ESIGN_DOCUMENT, documentId],
      });
    },
  });
  const batchStatus = batch.data?.status;
  useEffect(() => {
    if (batchStatus && !['queued', 'processing'].includes(batchStatus)) {
      void queryClient.invalidateQueries({
        queryKey: [queryKeys.ESIGN_DOCUMENT, documentId],
      });
      void queryClient.invalidateQueries({
        queryKey: [queryKeys.ESIGN_NOTIFICATION_BATCHES, documentId],
      });
    }
  }, [batchStatus, queryClient, documentId]);

  const noteMutation = useMutation({
    mutationFn: saveSignerNote,
    meta: { suppressGlobalErrorToast: true },
    onSuccess: (result) => {
      queryClient.setQueryData<EsignDocumentDetail>([queryKeys.ESIGN_DOCUMENT, documentId], (old) =>
        old
          ? {
              ...old,
              signers: old.signers.map((signer) =>
                signer.publicId === result.signerPublicId ? { ...signer, note: result.note } : signer,
              ),
            }
          : old,
      );
      void queryClient.invalidateQueries({
        queryKey: [queryKeys.ESIGN_DOCUMENT, documentId],
      });
    },
  });
  const saveNote = async (publicId: string, input: string) => {
    const result = normalizeSignerNote(input);
    if ('error' in result) return result;
    try {
      return await noteMutation.mutateAsync({
        id: documentId,
        signerPublicId: publicId,
        note: result.note,
      });
    } catch (error) {
      return { error: getErrorMessage(error, '儲存備註失敗，請稍後再試') };
    }
  };
  const download = useMutation({
    mutationFn: async (s: EsignSignerView) => {
      const blob = await downloadSignerCompletedFile({
        id: documentId,
        signerPublicId: s.publicId,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileNamePrefix}_${s.name}${s.employeeNo ?? ''}_已簽署.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    },
    meta: { suppressGlobalErrorToast: true },
    onError: (err) => showSnackbar(getErrorMessage(err, '匯出失敗，請稍後再試'), 'error'),
  });

  return (
    <>
      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  size="small"
                  disabled={!pageEligible.length || notify.isPending}
                  checked={pageEligible.length > 0 && pageEligible.every((id) => selectedEligible.includes(id))}
                  indeterminate={
                    pageEligible.some((id) => selectedEligible.includes(id)) &&
                    !pageEligible.every((id) => selectedEligible.includes(id))
                  }
                  onChange={(_, checked) =>
                    setSelected((old) =>
                      checked
                        ? [...new Set([...old, ...pageEligible])]
                        : old.filter((id) => !pageEligible.includes(id)),
                    )
                  }
                  slotProps={{
                    input: { 'aria-label': '選取本頁可催簽的外部簽署人' },
                  }}
                />
              </TableCell>
              {COLUMNS.map((c) =>
                c.key ? (
                  <SortableHeaderCell
                    key={c.label}
                    active={sort?.key === c.key}
                    order={sort?.order ?? 'asc'}
                    href={sortHrefs[c.key]}
                  >
                    {c.label}
                  </SortableHeaderCell>
                ) : (
                  <TableCell key={c.label}>
                    {c.unsupported ? (
                      <UnsupportedLabel chip={c.unsupported.chip} hint={c.unsupported.hint}>
                        {c.label}
                      </UnsupportedLabel>
                    ) : (
                      c.label
                    )}
                  </TableCell>
                ),
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUMNS.length + 1} align="center" sx={{ py: 6 }}>
                  <Typography variant="description">{emptyText}</Typography>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((s) => {
                const status = STATUS_META[s.status];
                const canDownload = s.status === 'signed' && s.completion.status === 'ready';
                return (
                  <TableRow key={s.publicId} hover>
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        disabled={!s.reminderEligibility?.eligible || notify.isPending}
                        checked={selectedEligible.includes(s.publicId)}
                        onChange={(_, checked) =>
                          setSelected((old) =>
                            checked ? [...new Set([...old, s.publicId])] : old.filter((id) => id !== s.publicId),
                          )
                        }
                        slotProps={{
                          input: { 'aria-label': `選取 ${s.name}` },
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      {/* content variant 預設渲染成 <p>，裡面不能放 Chip（<div>），改用 div */}
                      <Typography
                        variant="content"
                        component="div"
                        sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                      >
                        {s.name}
                        {s.type === 'email' && <Chip size="small" variant="soft" color="info" label="外部" />}
                      </Typography>
                      <Typography variant="helper">{s.type === 'email' ? s.email : s.employeeNo}</Typography>
                    </TableCell>
                    <TableCell>
                      {s.department ?? '—'}
                      {s.title && (
                        <Typography variant="helper" component="div">
                          {s.title}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" variant="soft" label={status.label} color={status.color} />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {formatTime(s.status === 'rejected' ? s.rejectedAt : s.signedAt)}
                    </TableCell>
                    <TableCell sx={{ overflowWrap: 'anywhere' }}>{s.rejectReason || '—'}</TableCell>
                    {/* 初邀與催簽分別顯示 */}
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {s.invitationDelivery ? (
                        <Typography
                          variant="content"
                          sx={s.invitationDelivery === 'failed' ? { color: 'error.dark' } : undefined}
                        >
                          {DELIVERY_LABEL[s.invitationDelivery]}
                        </Typography>
                      ) : (
                        <NoData />
                      )}
                      {s.latestInvitation?.completedAt && (
                        <Typography variant="helper">
                          初邀：
                          {notificationTime(s.latestInvitation.completedAt)}
                        </Typography>
                      )}
                      {s.latestReminder && (
                        <Typography variant="helper">
                          催簽：{notificationStatuses[s.latestReminder.status]}{' '}
                          {notificationTime(s.latestReminder.completedAt)}
                        </Typography>
                      )}
                      {s.type === 'email' && (
                        <Typography variant="helper">已寄出催簽 {s.deliveredReminderCount ?? 0} 次</Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ minWidth: 240 }}>
                      <SignerNoteCell signerName={s.name} note={s.note} onSave={(note) => saveNote(s.publicId, note)} />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <SingleReminderButton documentId={documentId} signer={s} />
                      {/* 個人副本產製完成後才能下載；產製失敗改顯示警示圖示 */}
                      {s.completion.status === 'failed' ? (
                        <Tooltip
                          title={`無法匯出：${COMPLETION_HINT.failed}${s.signedAt ? `（${formatTime(s.signedAt)} 簽署）` : ''}`}
                        >
                          <Box
                            component="span"
                            tabIndex={0}
                            aria-label={COMPLETION_HINT.failed}
                            sx={{
                              display: 'inline-flex',
                              p: '5px',
                              color: 'error.main',
                              verticalAlign: 'middle',
                            }}
                          >
                            <ReportProblemRoundedIcon />
                          </Box>
                        </Tooltip>
                      ) : (
                        <TooltipIconButton
                          label={
                            download.isPending && download.variables?.publicId === s.publicId
                              ? '匯出中…'
                              : canDownload
                                ? `匯出已簽署文件（個人副本 ${formatTime(s.completion.readyAt)} 產生）`
                                : s.status === 'signed' && s.completion.status
                                  ? `匯出已簽署文件（${COMPLETION_HINT[s.completion.status]}）`
                                  : '匯出已簽署文件（尚未簽署）'
                          }
                          icon={<FileDownloadRoundedIcon />}
                          color="info"
                          disabled={!canDownload || download.isPending}
                          onClick={() => download.mutate(s)}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {canNotify && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            flexWrap: 'wrap',
          }}
        >
          <Typography variant="secondary" component="span" sx={{ mr: 'auto' }}>
            勾選外部待簽署者後可批次通知；每人每日一次（台北時間午夜重置）
          </Typography>
          <Button
            variant="outlined"
            startIcon={<NotificationsActiveRoundedIcon />}
            disabled={!selectedEligible.length || notify.isPending}
            onClick={() => notify.mutate('selected')}
          >
            通知所選（{selectedEligible.length}）
          </Button>
          <Button
            variant="contained"
            startIcon={<NotificationsActiveRoundedIcon />}
            disabled={!eligibleExternalIds.length || notify.isPending}
            onClick={() => notify.mutate('all_pending')}
          >
            通知所有待簽外部簽署人（{eligibleExternalIds.length}）
          </Button>
        </Box>
      )}
      <NotificationHistory documentId={documentId} />
    </>
  );
}
