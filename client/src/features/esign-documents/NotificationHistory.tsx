'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/api/query-keys';
import { useGetNotificationBatchQuery, useGetNotificationBatchesQuery } from '@/api/queries/esignDocuments';
import type { NotificationListParams } from '@/api/types/esignDocuments';
import { notificationReasons, notificationStatuses, notificationTime } from './notificationLabels';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';

export default function NotificationHistory({ documentId }: { documentId: string }) {
  const [kind, setKind] = useState<NotificationListParams['kind']>();
  const [cursor, setCursor] = useState<string>();
  const [batchId, setBatchId] = useState<string | null>(null);
  const [itemCursor, setItemCursor] = useState<string>();
  const list = useGetNotificationBatchesQuery(documentId, {
    kind,
    cursor,
    limit: 10,
  });
  const client = useQueryClient();
  const historyState = list.data?.items.map((batch) => `${batch.batchId}:${batch.status}`).join(',');
  useEffect(() => {
    if (historyState)
      void client.invalidateQueries({
        queryKey: [queryKeys.ESIGN_DOCUMENT, documentId],
      });
  }, [historyState, client, documentId]);
  const detail = useGetNotificationBatchQuery(documentId, batchId, {
    cursor: itemCursor,
    limit: 20,
  });
  return (
    <Stack spacing={2}>
      <Typography variant="sectionTitle">通知歷史</Typography>
      <Typography variant="helper">
        已寄出表示郵件伺服器已接受，不代表已收件或已讀。催簽目前僅支援外部簽署人。
      </Typography>
      <Select
        size="small"
        value={kind ?? 'all'}
        inputProps={{ 'aria-label': '通知類型' }}
        onChange={(event) => {
          setKind(event.target.value === 'all' ? undefined : (event.target.value as NotificationListParams['kind']));
          setCursor(undefined);
        }}
      >
        <MenuItem value="all">全部通知</MenuItem>
        <MenuItem value="invitation">初次邀請</MenuItem>
        <MenuItem value="reminder">催簽</MenuItem>
      </Select>
      {list.isError && <Alert severity="error">無法讀取通知歷史，請稍後重試。</Alert>}
      <Box sx={{ overflowX: 'auto' }}>
        <Table aria-label="通知批次歷史">
          <TableHead>
            <TableRow>
              {['類型／時間', '操作者', '狀態', '受理／未寄', '明細'].map((label) => (
                <TableCell key={label}>{label}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {list.data?.items.map((batch) => (
              <TableRow key={batch.batchId}>
                <TableCell>
                  {batch.kind === 'invitation' ? '初次邀請' : '催簽'}
                  <Typography variant="helper">{notificationTime(batch.createdAt)}</Typography>
                </TableCell>
                <TableCell>{batch.requestedBy?.name ?? '系統'}</TableCell>
                <TableCell>{notificationStatuses[batch.status]}</TableCell>
                <TableCell>
                  {batch.queuedCount}／{batch.notSentCount}（共 {batch.selectedCount} 人）
                </TableCell>
                <TableCell>
                  <Button
                    onClick={() => {
                      setBatchId(batch.batchId);
                      setItemCursor(undefined);
                    }}
                  >
                    查看逐人結果
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!list.isLoading && !list.data?.items.length && (
              <TableRow>
                <TableCell colSpan={5}>沒有通知紀錄</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>
      <Box>
        <Button disabled={!cursor} onClick={() => setCursor(undefined)}>
          回到最新
        </Button>
        <Button disabled={!list.data?.nextCursor} onClick={() => setCursor(list.data?.nextCursor ?? undefined)}>
          較早的通知
        </Button>
      </Box>
      <Dialog open={batchId !== null} onClose={() => setBatchId(null)} fullWidth maxWidth="md">
        <DialogTitle>逐人通知結果</DialogTitle>
        <DialogContent>
          {detail.isError && <Alert severity="error">無法讀取通知明細。</Alert>}
          <Box sx={{ overflowX: 'auto' }}>
            <Table aria-label="逐人通知結果">
              <TableHead>
                <TableRow>
                  {['簽署人', '結果／原因', '嘗試次數', '完成時間'].map((label) => (
                    <TableCell key={label}>{label}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {detail.data?.items.map((item) => (
                  <TableRow key={item.signerPublicId}>
                    <TableCell>{item.name}</TableCell>
                    <TableCell>
                      {notificationStatuses[item.status] ?? item.status}
                      {item.reasonCode && (
                        <Typography variant="helper">
                          {notificationReasons[item.reasonCode] ?? '未能寄送，請稍後查詢'}
                        </Typography>
                      )}
                      {item.attemptHistory.length > 0 && (
                        <Box component="details">
                          <Box component="summary">查看嘗試歷程</Box>
                          {item.attemptHistory.map((attempt, i) => (
                            <Typography key={i} variant="helper" component="div">
                              {notificationTime(attempt.at)} {notificationStatuses[attempt.status] ?? attempt.status}
                              {attempt.reasonCode ? `：${notificationReasons[attempt.reasonCode] ?? '寄送未完成'}` : ''}
                            </Typography>
                          ))}
                        </Box>
                      )}
                    </TableCell>
                    <TableCell>{item.attemptCount}</TableCell>
                    <TableCell>{notificationTime(item.completedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
          <Button disabled={!itemCursor} onClick={() => setItemCursor(undefined)}>
            第一頁
          </Button>
          <Button
            disabled={!detail.data?.nextCursor}
            onClick={() => setItemCursor(detail.data?.nextCursor ?? undefined)}
          >
            下一頁明細
          </Button>
          <Button onClick={() => setBatchId(null)}>關閉</Button>
        </DialogContent>
      </Dialog>
    </Stack>
  );
}
