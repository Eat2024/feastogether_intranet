'use client';

import { useGetExportableDocumentsQuery, useGetExportsQuery } from '@/api/queries';
import { requestExport, retryExport } from '@/api/requests';
import { queryKeys } from '@/api/query-keys';
import type { EsignExport } from '@/api/types';
import { getErrorMessage } from '@/lib/apiError';
import { Alert, Box, Button, CircularProgress, LinearProgress, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

const labels: Record<EsignExport['status'], string> = { pending: '已排隊', waiting: '等待已簽副本產製', processing: '打包中', completed: '可下載', failed: '匯出失敗', expired: '已到期' };
const date = (value: string | null) => value ? new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '—';

export default function ZipExportsView() {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState<string>();
  const documents = useGetExportableDocumentsQuery({ q, cursor });
  const queryClient = useQueryClient();
  const create = useMutation({ mutationFn: requestExport, onSuccess: async () => {
    await queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_EXPORTS] });
    await documents.refetch();
  } });
  return <Stack spacing={3}>
    <Alert severity="info">可查找所有建立人的文件並匯出此次簽署的全部已簽副本。完成後七天內共用同一份 ZIP，新完成的簽署不會加入既有快照。</Alert>
    <Box component="form" onSubmit={event => { event.preventDefault(); setQ(search); setCursor(undefined); }} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
      <TextField label="搜尋文件名稱" value={search} onChange={event => setSearch(event.target.value)} size="small" />
      <Button type="submit" variant="outlined">查詢</Button>
    </Box>
    {documents.isPending && <CircularProgress size={24} />}
    {documents.isError && <Alert severity="error">{getErrorMessage(documents.error)}</Alert>}
    <TableContainer component={Paper} variant="outlined"><Table><TableHead><TableRow><TableCell>文件名稱</TableCell><TableCell>建立人</TableCell><TableCell>已簽份數</TableCell><TableCell>匯出</TableCell></TableRow></TableHead>
      <TableBody>{documents.data?.items.map(doc => <TableRow key={doc.documentId}>
        <TableCell>{doc.title}</TableCell><TableCell>{doc.creatorName}</TableCell><TableCell>{doc.signedCount}</TableCell>
        <TableCell><Button disabled={!doc.signedCount} loading={create.isPending && create.variables === doc.documentId} onClick={() => create.mutate(doc.documentId)}>匯出全部已簽副本</Button></TableCell>
      </TableRow>)}{documents.data?.items.length === 0 && <TableRow><TableCell colSpan={4}>沒有符合條件的文件</TableCell></TableRow>}</TableBody></Table></TableContainer>
    <Stack direction="row" spacing={1}><Button disabled={!cursor} onClick={() => setCursor(undefined)}>第一頁</Button><Button disabled={!documents.data?.nextCursor} onClick={() => setCursor(documents.data?.nextCursor ?? undefined)}>下一頁</Button></Stack>
    {create.isSuccess && <Alert severity="success">{create.data.reused ? '已沿用既有匯出工作或成果。' : '已受理匯出，可離開頁面，稍後從下方歷史紀錄下載。'}</Alert>}
    <ZipExportPanel />
  </Stack>;
}

export function ZipExportPanel({ documentId }: { documentId?: string }) {
  const [cursor, setCursor] = useState<string>();
  const history = useGetExportsQuery({ documentId, cursor });
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_EXPORTS] });
  const create = useMutation({ mutationFn: requestExport, onSuccess: refresh });
  const retry = useMutation({ mutationFn: retryExport, onSuccess: refresh });
  return <Stack spacing={2}>
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
      <Typography variant="subheading">已簽署副本 ZIP 匯出紀錄</Typography>
      {documentId && <Button variant="contained" loading={create.isPending} onClick={() => create.mutate(documentId)}>匯出全部已簽副本 ZIP</Button>}
      <Button onClick={() => history.refetch()} loading={history.isFetching}>重新整理</Button>
    </Box>
    {documentId && <Typography variant="description">ZIP 收錄此次簽署的所有已簽副本，不套用 Excel 的篩選。完成後保留七天，期間重用同一份成果。</Typography>}
    {history.isError && <Alert severity="error">{getErrorMessage(history.error)}</Alert>}
    {history.isPending && <CircularProgress size={24} />}
    {history.data?.items.length === 0 && <Typography variant="description">尚無匯出紀錄。</Typography>}
    {history.data?.items.map(job => <Paper key={job.id} variant="outlined" sx={{ p: 2 }}><Stack spacing={1}>
      <Typography variant="content">文件 {job.documentId} · {labels[job.status]} · {job.expectedCount} 份</Typography>
      <Typography variant="description">收錄時間：{date(job.snapshotAt)} · 到期時間：{date(job.expiresAt)}{job.requesterName ? ` · 申請者：${job.requesterName}` : ''}</Typography>
      {['pending', 'waiting', 'processing'].includes(job.status) && <><LinearProgress variant="determinate" value={job.expectedCount ? job.processedCount / job.expectedCount * 100 : 0} /><Typography variant="helper">已處理 {job.processedCount}/{job.expectedCount}，等待副本 {job.waitingCount}。完成全部打包後才可下載。</Typography></>}
      {job.status === 'failed' && <Alert severity="error">{job.failureCode === 'ESIGN_INTEGRITY_FAILED' ? '來源副本完整性異常，請聯絡系統管理員。' : job.failureCode === 'ESIGN_EXPORT_SOURCE_FAILED' ? '既有已簽副本產製失敗，待修復後可重試原快照。' : '匯出失敗，可重試原快照。'}</Alert>}
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
        {job.files.map(file => <Button key={file.id} component="a" href={file.downloadPath} download={file.fileName} variant="contained">下載 ZIP（{(file.size / 1024 / 1024).toFixed(1)} MB）</Button>)}
        {job.status === 'failed' && job.failureCode !== 'ESIGN_INTEGRITY_FAILED' && <Button loading={retry.isPending} onClick={() => retry.mutate(job)}>重試原快照</Button>}
        {job.status === 'expired' && <Button loading={create.isPending} onClick={() => create.mutate(job.documentId)}>重新申請匯出</Button>}
      </Stack>
    </Stack></Paper>)}
    <Stack direction="row" spacing={1}><Button disabled={!cursor} onClick={() => setCursor(undefined)}>第一頁</Button><Button disabled={!history.data?.nextCursor} onClick={() => setCursor(history.data?.nextCursor ?? undefined)}>下一頁</Button></Stack>
  </Stack>;
}
