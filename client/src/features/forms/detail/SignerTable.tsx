'use client';

import ConfirmDialog from '@/components/ConfirmDialog';
import SortableHeaderCell from '@/components/SortableHeaderCell';
import TooltipIconButton from '@/components/TooltipIconButton';
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip, { type ChipProps } from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Snackbar from '@mui/material/Snackbar';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useState, useTransition } from 'react';
import { notifySigners } from '../actions';
import type { Signer } from '../types';
import ExportSignerCopyButton from './ExportSignerCopyButton';
import type { SignerRowData, SignerSort, SignerSortKey } from './signerQuery';

const STATUS_META: Record<Signer['status'], { label: string; color: ChipProps['color'] }> = {
  pending: { label: '待簽署', color: 'warning' },
  signed: { label: '已簽署', color: 'success' },
  rejected: { label: '已拒絕', color: 'error' },
};

const COLUMNS: { key?: SignerSortKey; label: string }[] = [
  { key: 'name', label: '簽署人' },
  { key: 'dept', label: '部門' },
  { key: 'status', label: '狀態' },
  { key: 'time', label: '簽署／拒絕時間' },
  { label: '拒絕原因' },
  { key: 'notify', label: '通知紀錄' },
  { label: '操作' },
];

/** 要通知的對象：指定的 id，或 'allPending'（文件中所有待簽署者，不限本頁） */
type NotifyTarget = { ids: string[]; count: number } | { allPending: true; count: number };

export default function SignerTable({
  formId,
  rows,
  sort,
  sortHrefs,
  canNotify,
  pendingTotal,
  emptyText,
}: {
  formId: string;
  /** 本頁的簽署人（已篩選、排序、分頁） */
  rows: SignerRowData[];
  sort: SignerSort;
  /** 各欄點擊後的排序網址 */
  sortHrefs: Record<SignerSortKey, string>;
  /** 文件為簽署中才能通知 */
  canNotify: boolean;
  /** 整份文件待簽署人數（「通知所有未簽署者」用） */
  pendingTotal: number;
  emptyText: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<NotifyTarget | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const notifiable = canNotify ? rows.filter((s) => s.status === 'pending') : [];
  // 換頁或資料更新後，只保留本頁仍可通知的勾選
  const selectedHere = notifiable.filter((s) => selected.has(s.id));
  const allChecked = notifiable.length > 0 && selectedHere.length === notifiable.length;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const send = () => {
    if (!target) return;
    startTransition(async () => {
      const res = await notifySigners(
        'allPending' in target ? { formId } : { formId, signerIds: target.ids },
      );
      setTarget(null);
      if ('error' in res) setResult({ ok: false, message: res.error });
      else {
        setResult({ ok: true, message: `已通知 ${res.count} 位簽署人` });
        setSelected(new Set());
      }
    });
  };

  return (
    <>
      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  size="small"
                  checked={allChecked}
                  indeterminate={selectedHere.length > 0 && !allChecked}
                  disabled={notifiable.length === 0}
                  onChange={() =>
                    setSelected(allChecked ? new Set() : new Set(notifiable.map((s) => s.id)))
                  }
                  slotProps={{ input: { 'aria-label': '選取本頁所有待簽署者' } }}
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
                const canPick = canNotify && s.status === 'pending';
                const status = STATUS_META[s.status];
                return (
                  <TableRow key={s.id} hover selected={selected.has(s.id)}>
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={selected.has(s.id)}
                        disabled={!canPick}
                        onChange={() => toggle(s.id)}
                        slotProps={{ input: { 'aria-label': `選取 ${s.name}` } }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="content">{s.name}</Typography>
                      <Typography variant="helper">{s.email ?? s.employeeNo}</Typography>
                    </TableCell>
                    <TableCell>{s.dept ?? '—'}</TableCell>
                    <TableCell>
                      <Chip size="small" variant="soft" label={status.label} color={status.color} />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{s.signedAt ?? s.rejectedAt ?? '—'}</TableCell>
                    <TableCell>
                      {s.rejectReason ? (
                        <Typography variant="content" sx={{ minWidth: 200, overflowWrap: 'anywhere' }}>
                          {s.rejectReason}
                        </Typography>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {s.notifyCount ? (
                        <>
                          <Typography variant="content">已通知 {s.notifyCount} 次</Typography>
                          <Typography variant="helper">最後 {s.lastNotifiedAt ?? '—'}</Typography>
                        </>
                      ) : s.status === 'pending' ? (
                        <Typography variant="secondary">尚未通知過</Typography>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <TooltipIconButton
                        label="通知"
                        icon={<NotificationsActiveRoundedIcon />}
                        color="info"
                        disabled={!canPick || pending}
                        onClick={() => setTarget({ ids: [s.id], count: 1 })}
                      />
                      {/* 只有已簽署的人有已簽署文件可以匯出 */}
                      <ExportSignerCopyButton
                        formId={formId}
                        signerId={s.id}
                        disabled={s.status !== 'signed'}
                        onError={(message) => setResult({ ok: false, message })}
                      />
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
            {selectedHere.length > 0 ? `已選 ${selectedHere.length} 位` : '勾選待簽署者後可批次通知'}
          </Typography>
          <Button
            size="large"
            variant="outlined"
            startIcon={<NotificationsActiveRoundedIcon />}
            disabled={selectedHere.length === 0 || pending}
            onClick={() => setTarget({ ids: selectedHere.map((s) => s.id), count: selectedHere.length })}
          >
            通知所選（{selectedHere.length}）
          </Button>
          <Button
            size="large"
            variant="contained"
            startIcon={<NotificationsActiveRoundedIcon />}
            disabled={pendingTotal === 0 || pending}
            onClick={() => setTarget({ allPending: true, count: pendingTotal })}
          >
            通知所有未簽署者（{pendingTotal}）
          </Button>
        </Box>
      )}

      <ConfirmDialog
        open={!!target}
        icon={<NotificationsActiveRoundedIcon />}
        title={`通知 ${target?.count ?? 0} 位簽署人？`}
        description={
          target && 'allPending' in target
            ? '將提醒此文件所有尚未簽署的人員（不限目前頁面）盡快完成簽署。'
            : '將提醒所選人員盡快完成簽署。'
        }
        confirmLabel={pending ? '送出中…' : '送出通知'}
        onConfirm={() => !pending && send()}
        onClose={() => !pending && setTarget(null)}
      />
      <Snackbar
        open={!!result}
        autoHideDuration={3000}
        onClose={() => setResult(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {result ? (
          <Alert severity={result.ok ? 'success' : 'error'} onClose={() => setResult(null)}>
            {result.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </>
  );
}
