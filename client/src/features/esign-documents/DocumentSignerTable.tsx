'use client';

// 檢視頁（後端文件）的簽署人清單：本頁資料已在外層篩選、排序、分頁。
// 欄位與 mock 版相同；後端尚未提供的資料（拒絕原因、通知次數、備註）與操作（通知）保留位置並標示「後端未支援」。
// 外部簽署人的邀請信寄送結果顯示在「通知紀錄」，個人副本產製狀態顯示在操作欄的匯出按鈕。
import SingleReminderButton from './SingleReminderButton';
import type { EsignSignerStatus, EsignSignerView } from '@/api/types';
import { downloadSignerCompletedFile } from '@/api/requests';
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
import { useMutation } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState, type ReactNode } from 'react';
import type { SignerSort, SignerSortKey } from './signerQuery';

const UNSUPPORTED = '後端尚未支援';

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
const COLUMNS: { key?: SignerSortKey; label: string; unsupported?: { chip: string; hint: string } }[] = [
  { key: 'name', label: '簽署人' },
  { key: 'dept', label: '部門' },
  { key: 'status', label: '狀態' },
  { key: 'time', label: '簽署／拒絕時間' },
  { label: '拒絕原因', unsupported: { chip: '未支援', hint: `${UNSUPPORTED}，目前沒有資料` } },
  {
    label: '通知紀錄',
    unsupported: { chip: '部分支援', hint: `通知次數與時間${UNSUPPORTED}，目前只顯示外部簽署人的邀請信寄送結果` },
  },
  {
    label: '備註',
    unsupported: { chip: '未支援', hint: `${UNSUPPORTED}：可以輸入，但只暫存在此頁面，重新整理後就會消失` },
  },
  { label: '操作' },
];

const formatTime = (iso: string | null) => (iso ? dayjs(iso).format('YYYY/MM/DD HH:mm') : '—');

/** 表頭文字加上「未支援」等標示 */
function UnsupportedLabel({ children, chip, hint }: { children: ReactNode; chip: string; hint: string }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, whiteSpace: 'nowrap' }}>
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
function UnsupportedButton({ children, variant }: { children: ReactNode; variant: 'outlined' | 'contained' }) {
  return (
    <Tooltip title={UNSUPPORTED}>
      <span>
        <Button size="large" variant={variant} startIcon={<NotificationsActiveRoundedIcon />} disabled>
          {children}
        </Button>
      </span>
    </Tooltip>
  );
}

export default function DocumentSignerTable({
  documentId,
  fileNamePrefix,
  rows,
  sort,
  sortHrefs,
  canNotify,
  pendingTotal,
  emptyText,
}: {
  documentId: string;
  /** 匯出檔名的前綴（文件編號與名稱） */
  fileNamePrefix: string;
  rows: EsignSignerView[];
  sort: SignerSort;
  /** 各欄點擊後的排序網址 */
  sortHrefs: Record<SignerSortKey, string>;
  /** 文件為簽署中時顯示通知列（後端尚未支援，按鈕停用） */
  canNotify: boolean;
  /** 整份文件待簽署人數 */
  pendingTotal: number;
  emptyText: string;
}) {
  const { showSnackbar } = useSnackbar();
  // TODO: 後端支援簽署人備註後改為呼叫 API；目前只暫存在頁面上（簽署人 publicId → 備註）
  const [notes, setNotes] = useState<Record<string, string>>({});
  const saveNote = async (publicId: string, input: string) => {
    const res = normalizeSignerNote(input);
    if ('note' in res) setNotes((prev) => ({ ...prev, [publicId]: res.note }));
    return res;
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
                <Tooltip title={`批次通知：${UNSUPPORTED}`}>
                  <span>
                    <Checkbox size="small" disabled slotProps={{ input: { 'aria-label': '選取本頁所有待簽署者' } }} />
                  </span>
                </Tooltip>
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
                      <Checkbox size="small" disabled slotProps={{ input: { 'aria-label': `選取 ${s.name}` } }} />
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
                    {/* 後端目前只有簽署時間（沒有拒簽流程） */}
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatTime(s.signedAt)}</TableCell>
                    <TableCell>
                      <NoData />
                    </TableCell>
                    {/* 通知次數後端尚未支援；外部簽署人顯示邀請信寄送結果 */}
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
                    </TableCell>
                    <TableCell sx={{ minWidth: 240 }}>
                      <SignerNoteCell
                        signerName={s.name}
                        note={notes[s.publicId]}
                        onSave={(note) => saveNote(s.publicId, note)}
                      />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <SingleReminderButton documentId={documentId} signer={s} />
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
            勾選待簽署者後可批次通知（{UNSUPPORTED}）
          </Typography>
          <UnsupportedButton variant="outlined">通知所選（0）</UnsupportedButton>
          <UnsupportedButton variant="contained">通知所有未簽署者（{pendingTotal}）</UnsupportedButton>
        </Box>
      )}
    </>
  );
}
