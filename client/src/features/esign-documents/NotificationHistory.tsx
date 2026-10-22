'use client';

// 檢視頁的通知紀錄：GET /api/esign/documents/:id/notification-batches 列出初次邀請與催簽批次（由新到舊），
// 點「逐人結果」以 GET .../notification-batches/:batchId 查看每位簽署人的寄送結果與嘗試歷程。
import { useGetNotificationBatchesQuery, useGetNotificationBatchQuery } from '@/api/queries';
import type { NotificationListParams } from '@/api/types';
import { getErrorMessage } from '@/lib/apiError';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { notificationReason, notificationStatus, notificationTime } from './notificationLabels';

const KIND_LABEL = { invitation: '初次邀請', reminder: '催簽' } as const;
const PAGE_SIZE = 10;

export default function NotificationHistory({ documentId }: { documentId: string }) {
  const [kind, setKind] = useState<NotificationListParams['kind']>();
  // cursor 分頁：記錄已走過的頁面起點，才能回到上一頁
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const cursor = cursors.at(-1);
  const list = useGetNotificationBatchesQuery(documentId, { kind, cursor, limit: PAGE_SIZE });
  const [batchId, setBatchId] = useState<string | null>(null);

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ mr: 'auto' }}>
          <Typography variant="sectionTitle" component="h2">
            通知紀錄
          </Typography>
          <Typography variant="helper" component="div">
            「已寄出」表示郵件伺服器已接受，不代表對方已收到或已讀。
          </Typography>
        </Box>
        <TextField
          select
          size="small"
          label="通知類型"
          value={kind ?? 'all'}
          onChange={(e) => {
            setKind(e.target.value === 'all' ? undefined : (e.target.value as NotificationListParams['kind']));
            setCursors([undefined]);
          }}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="all">全部</MenuItem>
          <MenuItem value="invitation">初次邀請</MenuItem>
          <MenuItem value="reminder">催簽</MenuItem>
        </TextField>
      </Box>

      {list.isError && <Alert severity="error">無法取得通知紀錄：{getErrorMessage(list.error)}</Alert>}

      <TableContainer component={Paper} variant="outlined">
        <Table aria-label="通知紀錄">
          <TableHead>
            <TableRow>
              {['時間', '類型', '操作者', '狀態', '受理／未寄出', ''].map((label) => (
                <TableCell key={label}>{label}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {list.data?.items.map((b) => (
              <TableRow key={b.batchId}>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{notificationTime(b.createdAt)}</TableCell>
                <TableCell>{KIND_LABEL[b.kind]}</TableCell>
                <TableCell>{b.requestedBy?.name ?? '系統'}</TableCell>
                <TableCell>{notificationStatus(b.status)}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  {b.queuedCount}／{b.notSentCount}（共 {b.selectedCount} 人）
                </TableCell>
                <TableCell align="right">
                  <Button size="small" onClick={() => setBatchId(b.batchId)}>
                    逐人結果
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {list.isSuccess && list.data.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                  <Typography variant="description">目前沒有通知紀錄。</Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {(cursors.length > 1 || list.data?.nextCursor) && (
        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
          <Button size="small" disabled={cursors.length <= 1} onClick={() => setCursors((prev) => prev.slice(0, -1))}>
            較新的通知
          </Button>
          <Button
            size="small"
            disabled={!list.data?.nextCursor}
            onClick={() => list.data?.nextCursor && setCursors((prev) => [...prev, list.data.nextCursor ?? undefined])}
          >
            較早的通知
          </Button>
        </Box>
      )}

      {batchId && (
        <BatchDetailDialog documentId={documentId} batchId={batchId} onClose={() => setBatchId(null)} />
      )}
    </Stack>
  );
}

/** 一個通知批次的逐人寄送結果；寄送中時自動更新 */
function BatchDetailDialog({
  documentId,
  batchId,
  onClose,
}: {
  documentId: string;
  batchId: string;
  onClose: () => void;
}) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const detail = useGetNotificationBatchQuery(documentId, batchId, { cursor: cursors.at(-1), limit: 20 });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>逐人通知結果</DialogTitle>
      <Divider />
      <DialogContent>
        {detail.isError && <Alert severity="error">無法取得通知結果：{getErrorMessage(detail.error)}</Alert>}
        <TableContainer component={Paper} variant="outlined">
          <Table aria-label="逐人通知結果">
            <TableHead>
              <TableRow>
                {['簽署人', '結果', '嘗試次數', '完成時間'].map((label) => (
                  <TableCell key={label}>{label}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {detail.data?.items.map((item) => (
                <TableRow key={item.signerPublicId}>
                  <TableCell>{item.name}</TableCell>
                  <TableCell>
                    <Typography variant="content" component="div">
                      {notificationStatus(item.status)}
                    </Typography>
                    {item.reasonCode && (
                      <Typography variant="helper" component="div">
                        {notificationReason(item.reasonCode, '寄送未完成')}
                      </Typography>
                    )}
                    {item.attemptHistory.length > 1 && (
                      <Box component="details" sx={{ mt: 0.5 }}>
                        <Typography variant="helper" component="summary" sx={{ cursor: 'pointer' }}>
                          嘗試歷程
                        </Typography>
                        {item.attemptHistory.map((a, i) => (
                          <Typography key={i} variant="helper" component="div">
                            {notificationTime(a.at)} {notificationStatus(a.status)}
                            {a.reasonCode && `：${notificationReason(a.reasonCode, '寄送未完成')}`}
                          </Typography>
                        ))}
                      </Box>
                    )}
                  </TableCell>
                  <TableCell>{item.attemptCount}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{notificationTime(item.completedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button disabled={cursors.length <= 1} onClick={() => setCursors((prev) => prev.slice(0, -1))}>
          上一頁
        </Button>
        <Button
          disabled={!detail.data?.nextCursor}
          onClick={() => detail.data?.nextCursor && setCursors((prev) => [...prev, detail.data.nextCursor ?? undefined])}
        >
          下一頁
        </Button>
        <Button variant="contained" onClick={onClose} sx={{ ml: 'auto' }}>
          關閉
        </Button>
      </DialogActions>
    </Dialog>
  );
}
