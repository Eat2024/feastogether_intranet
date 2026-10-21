'use client';

// 檢視頁（後端文件）的簽署人清單：本頁資料已在外層篩選、排序、分頁。
// 欄位與 mock 版相同。催簽只支援外部簽署人（每人每日一次），內部員工的通知按鈕停用並說明原因。
// 備註呼叫 PATCH /api/esign/documents/:id/signers/:signerPublicId/note 儲存。
// 外部簽署人的邀請信寄送結果顯示在「通知紀錄」，個人副本產製狀態顯示在操作欄的匯出按鈕。
import { queryKeys } from '@/api/query-keys';
import type { EsignDocumentDetail, EsignManagedSignerView, EsignSignerStatus, EsignSignerView } from '@/api/types';
import { downloadSignerCompletedFile, saveSignerNote } from '@/api/requests';
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
import { useState } from 'react';
import { notificationReason, notificationStatus, notificationTime } from './notificationLabels';
import type { SignerSort, SignerSortKey } from './signerQuery';
import { useNotify } from './useNotify';

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

const COLUMNS: { key?: SignerSortKey; label: string }[] = [
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

/** 沒有資料的儲存格 */
const NoData = () => <Typography sx={{ color: 'text.disabled' }}>—</Typography>;

export default function DocumentSignerTable({
  documentId,
  fileNamePrefix,
  rows,
  sort,
  sortHrefs,
  canNotify,
  eligibleIds,
  emptyText,
}: {
  documentId: string;
  /** 匯出檔名的前綴（文件編號與名稱） */
  fileNamePrefix: string;
  rows: EsignManagedSignerView[];
  sort: SignerSort;
  /** 各欄點擊後的排序網址 */
  sortHrefs: Record<SignerSortKey, string>;
  /** 文件為簽署中時顯示批次通知列 */
  canNotify: boolean;
  /** 整份文件目前可催簽的簽署人（外部、待簽署、今天還沒催簽） */
  eligibleIds: string[];
  emptyText: string;
}) {
  const { showSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const notify = useNotify(documentId);
  // 勾選要批次通知的簽署人；只保留目前仍可催簽的人
  const [picked, setPicked] = useState<string[]>([]);
  const selected = picked.filter((id) => eligibleIds.includes(id));
  const pageEligible = rows.filter((s) => s.reminderEligibility.eligible).map((s) => s.publicId);
  const pageAllSelected = pageEligible.length > 0 && pageEligible.every((id) => selected.includes(id));
  const sendNotify = (target: Parameters<typeof notify.mutate>[0]) =>
    notify.mutate(target, { onSuccess: () => setPicked([]) });
  const noteMutation = useMutation({
    mutationFn: saveSignerNote,
    // 錯誤顯示在備註欄
    meta: { suppressGlobalErrorToast: true },
    onSuccess: (result) => {
      // 先更新畫面上的備註，再重新取得文件詳情
      queryClient.setQueryData<EsignDocumentDetail>([queryKeys.ESIGN_DOCUMENT, documentId], (old) =>
        old && {
          ...old,
          signers: old.signers.map((s) => (s.publicId === result.signerPublicId ? { ...s, note: result.note } : s)),
        },
      );
      void queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_DOCUMENT, documentId] });
    },
  });
  /** 備註欄的儲存：先以與後端相同的規則檢查，再呼叫 API；失敗時回傳錯誤訊息顯示在欄位上 */
  const saveNote = async (publicId: string, input: string) => {
    const res = normalizeSignerNote(input);
    if ('error' in res) return res;
    try {
      return await noteMutation.mutateAsync({ id: documentId, signerPublicId: publicId, note: res.note });
    } catch (err) {
      return { error: getErrorMessage(err, '儲存備註失敗，請稍後再試') };
    }
  };
  const download = useMutation({
    mutationFn: async (s: EsignSignerView) => {
      const blob = await downloadSignerCompletedFile({ id: documentId, signerPublicId: s.publicId });
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
                  checked={pageAllSelected}
                  indeterminate={!pageAllSelected && pageEligible.some((id) => selected.includes(id))}
                  onChange={(_, checked) =>
                    setPicked((prev) =>
                      checked ? [...new Set([...prev, ...pageEligible])] : prev.filter((id) => !pageEligible.includes(id)),
                    )
                  }
                  slotProps={{ input: { 'aria-label': '選取本頁可催簽的外部簽署人' } }}
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
                  <TableCell key={c.label}>{c.label}</TableCell>
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
                        disabled={!s.reminderEligibility.eligible || notify.isPending}
                        checked={selected.includes(s.publicId)}
                        onChange={(_, checked) =>
                          setPicked((prev) => (checked ? [...prev, s.publicId] : prev.filter((id) => id !== s.publicId)))
                        }
                        slotProps={{ input: { 'aria-label': `選取 ${s.name}` } }}
                      />
                    </TableCell>
                    <TableCell>
                      {/* content variant 預設渲染成 <p>，裡面不能放 Chip（<div>），改用 div */}
                      <Typography variant="content" component="div" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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
                    {/* 已簽署顯示簽署時間、已拒絕顯示拒絕時間 */}
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatTime(s.signedAt ?? s.rejectedAt)}</TableCell>
                    {/* 拒絕原因為選填，沒填時顯示「—」；完整顯示並自動換行 */}
                    <TableCell>
                      {s.rejectReason ? (
                        <Typography variant="content" sx={{ minWidth: 200, overflowWrap: 'anywhere' }}>
                          {s.rejectReason}
                        </Typography>
                      ) : (
                        <NoData />
                      )}
                    </TableCell>
                    {/* 外部簽署人：邀請信結果、最近一次催簽與已寄出的催簽次數；內部員工沒有通知紀錄 */}
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {s.type === 'email' ? (
                        <>
                          {s.invitationDelivery ? (
                            <Typography
                              variant="content"
                              component="div"
                              sx={s.invitationDelivery === 'failed' ? { color: 'error.dark' } : undefined}
                            >
                              {DELIVERY_LABEL[s.invitationDelivery]}
                            </Typography>
                          ) : (
                            // 補簽後不再顯示初次邀請的結果
                            <NoData />
                          )}
                          {s.latestInvitation?.completedAt && (
                            <Typography variant="helper" component="div">
                              邀請 {notificationTime(s.latestInvitation.completedAt)}
                            </Typography>
                          )}
                          {s.latestReminder && (
                            <Typography variant="helper" component="div">
                              催簽{notificationStatus(s.latestReminder.status)}
                              {s.latestReminder.completedAt && ` ${notificationTime(s.latestReminder.completedAt)}`}
                            </Typography>
                          )}
                          <Typography variant="helper" component="div">
                            已寄出催簽 {s.deliveredReminderCount} 次
                          </Typography>
                        </>
                      ) : (
                        <NoData />
                      )}
                    </TableCell>
                    <TableCell sx={{ minWidth: 240 }}>
                      <SignerNoteCell
                        signerName={s.name}
                        note={s.note}
                        onSave={(note) => saveNote(s.publicId, note)}
                      />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {/* 單人催簽：不能催簽時停用並說明原因 */}
                      <TooltipIconButton
                        label={
                          s.reminderEligibility.eligible
                            ? '通知（寄送催簽信，每人每日一次）'
                            : `通知（${notificationReason(s.reminderEligibility.reasonCode)}）`
                        }
                        icon={<NotificationsActiveRoundedIcon />}
                        color="info"
                        disabled={!s.reminderEligibility.eligible || notify.isPending}
                        onClick={() => sendNotify({ selection: 'selected', signerPublicIds: [s.publicId] })}
                      />
                      {/* 個人副本產製完成後才能下載；產製失敗改顯示警示圖示 */}
                      {s.completion.status === 'failed' ? (
                        <Tooltip title={`無法匯出：${COMPLETION_HINT.failed}${s.signedAt ? `（${formatTime(s.signedAt)} 簽署）` : ''}`}>
                          <Box
                            component="span"
                            tabIndex={0}
                            aria-label={COMPLETION_HINT.failed}
                            sx={{ display: 'inline-flex', p: '5px', color: 'error.main', verticalAlign: 'middle' }}
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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="secondary" component="span" sx={{ mr: 'auto' }}>
            勾選外部待簽署者後可批次通知；每人每日一次（台北時間午夜重置），內部員工不寄送催簽
          </Typography>
          <Button
            size="large"
            variant="outlined"
            startIcon={<NotificationsActiveRoundedIcon />}
            disabled={!selected.length || notify.isPending}
            onClick={() => sendNotify({ selection: 'selected', signerPublicIds: selected })}
          >
            通知所選（{selected.length}）
          </Button>
          <Button
            size="large"
            variant="contained"
            startIcon={<NotificationsActiveRoundedIcon />}
            disabled={!eligibleIds.length || notify.isPending}
            onClick={() => sendNotify({ selection: 'all_pending' })}
          >
            通知所有可催簽的外部簽署人（{eligibleIds.length}）
          </Button>
        </Box>
      )}
    </>
  );
}
