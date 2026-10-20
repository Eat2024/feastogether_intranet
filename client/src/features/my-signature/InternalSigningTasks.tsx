'use client';
import { formatTaipeiDateTime } from '@/lib/dates';

import { useGetInternalSigningTasksQuery } from '@/api/queries';
import { internalSourceFileUrl, rejectInternalTask } from '@/api/requests';
import type { ExternalSigningTask } from '@/api/types';
import { queryKeys } from '@/api/query-keys';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import RejectDialog from './sign/RejectDialog';

/** 員工 session 下的本人任務；拒簽直接送正式 API，不寫入原型 store。 */
export default function InternalSigningTasks() {
  const tasks = useGetInternalSigningTasksQuery();
  const cache = useQueryClient();
  const [selected, setSelected] = useState<ExternalSigningTask | null>(null);
  const request = useRef<{ signerPublicId: string; reason: string; requestId: string } | null>(null);
  const rejection = useMutation({
    mutationFn: ({ signerPublicId, ...body }: { signerPublicId: string; reason: string; requestId: string }) => rejectInternalTask(signerPublicId, body),
    onSuccess: async () => { setSelected(null); await cache.invalidateQueries({ queryKey: [queryKeys.INTERNAL_SIGNING_TASKS] }); },
  });
  if (tasks.isPending) return <Typography>載入文件中…</Typography>;
  if (tasks.isError) return <Alert severity="error">無法讀取本人文件，請稍後重試。</Alert>;
  return <Stack spacing={2}>
    {tasks.data.length === 0 && <Alert severity="info">目前沒有指派給你的文件。</Alert>}
    {tasks.data.map((task) => <Paper key={task.signerPublicId} variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Typography variant="sectionTitle">{task.document.title}</Typography>
        <Typography>{task.signer.status === 'rejected' ? '已拒絕' : task.signer.status === 'signed' ? '已簽署' : '待簽署'}</Typography>
        {task.signer.status === 'rejected' ? <Typography>{task.signer.rejectedAt && formatTaipeiDateTime(task.signer.rejectedAt)}<br />{task.signer.rejectReason || '未填寫拒絕原因'}</Typography> : <Button href={internalSourceFileUrl(task.signerPublicId)} target="_blank" rel="noopener">檢視文件</Button>}
        {task.allowReject && task.signer.status === 'pending' && <Button color="error" onClick={() => setSelected(task)}>拒絕簽署</Button>}
      </Stack>
    </Paper>)}
    <RejectDialog open={selected !== null} docName={selected?.document.title ?? ''} pending={rejection.isPending} onClose={() => setSelected(null)} onConfirm={(rawReason) => {
      if (!selected) return;
      const reason = rawReason.trim();
      if (!request.current || request.current.signerPublicId !== selected.signerPublicId || request.current.reason !== reason) request.current = { signerPublicId: selected.signerPublicId, reason, requestId: crypto.randomUUID() };
      rejection.mutate(request.current);
    }} />
  </Stack>;
}
