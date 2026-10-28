'use client';

// 本人簽署：員工 session 授權，開啟事件使用 POST，狀態刷新使用 GET 列表。
import { useGetSigningTasksQuery } from '@/api/queries';
import type { EsignSigningTask, SigningTaskSignatureResult, SigningTaskRejectionResult } from '@/api/types';
import PageHeader from '@/components/PageHeader';
import { formatDate } from '@/features/esign-documents/listQuery';
import { getErrorMessage } from '@/lib/apiError';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import VerifiedRoundedIcon from '@mui/icons-material/VerifiedRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/api/query-keys';
import { openSigningTask, signingTaskSourceFileUrl, submitSigningTaskSignatures, rejectSigningTask, downloadSigningTaskCompletedFile } from '@/api/requests';
import { usePdfDocument } from '@/features/forms/pdf/usePdf';
import SigningForm from '@/features/my-signature/sign/SigningForm';
import TermsStep from '@/features/my-signature/sign/TermsStep';
import SignSteps from '@/features/my-signature/sign/SignSteps';
import { taipeiDateTime } from '@/features/my-signature/sign/signingTaskForm';
import { backHref, signBlock } from './taskQuery';

function BackButton({ href }: { href: string }) {
  return (
    <Box>
      <Button variant="text" startIcon={<ArrowBackRoundedIcon />} href={href}>
        返回我的電子簽
      </Button>
    </Box>
  );
}

function Loading() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 8 }}>
      <CircularProgress size={20} />
      <Typography variant="description">載入文件中…</Typography>
    </Box>
  );
}

export default function SigningTaskView({ signerPublicId }: { signerPublicId: string }) {
  const { data, isPending, isError, error, refetch, isFetching } = useGetSigningTasksQuery({}, {
    refetchInterval: (query) => {
      if (query.state.status === 'error') return false;
      const current = query.state.data?.find((task) => task.signerPublicId === signerPublicId);
      return current?.signer.status === 'signed' && ['pending', 'processing'].includes(current.signer.completion.status ?? '') ? 2000 : false;
    },
  });

  if (isPending) return <Loading />;
  if (isError) {
    return (
      <>
        <BackButton href="/my-signature" />
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => refetch()} loading={isFetching}>
              重新載入
            </Button>
          }
        >
          無法取得簽署任務：{getErrorMessage(error)}
        </Alert>
      </>
    );
  }
  const task = data.find((t) => t.signerPublicId === signerPublicId);
  if (!task) {
    // 不是本人的任務就當作不存在，不透露文件資訊
    return (
      <>
        <BackButton href="/my-signature" />
        <Alert severity="warning" variant="outlined">
          找不到此簽署任務，可能是連結有誤，或你不是此文件的簽署人。
        </Alert>
      </>
    );
  }
  // 以 key 區分任務：換到另一份文件時不沿用簽署中的狀態
  return <Task key={task.signerPublicId} task={task} />;
}

function Task({ task: listedTask }: { task: EsignSigningTask }) {
  const queryClient = useQueryClient();
  const open = useMutation({
    mutationFn: openSigningTask,
    meta: { suppressGlobalErrorToast: true },
    onSuccess: (openedTask) => {
      // open 只記一次事件；把回應合入列表快取，後續以 GET 的新狀態為準。
      queryClient.setQueriesData<EsignSigningTask[]>({ queryKey: [queryKeys.ESIGN_SIGNING_TASKS] },
        (current) => current?.map((item) => item.signerPublicId === openedTask.signerPublicId ? openedTask : item));
    },
  });
  const download = useMutation({
    mutationFn: downloadSigningTaskCompletedFile,
    onSuccess: ({ bytes, fileName }) => {
      const url = URL.createObjectURL(bytes);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    },
  });
  const { mutate: openTask } = open;
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    openTask(listedTask.signerPublicId);
  }, [openTask, listedTask.signerPublicId]);
  const [consented, setConsented] = useState(false);
  const [result, setResult] = useState<SigningTaskSignatureResult | null>(null);
  const [rejection, setRejection] = useState<SigningTaskRejectionResult | null>(null);
  const task = listedTask;
  const { document: doc, signer } = task;
  const signedAt = result?.signedAt ?? signer.signedAt;
  const rejectedAt = rejection?.rejectedAt ?? signer.rejectedAt;
  const copyStatus = signer.status === 'signed' ? signer.completion.status : result?.completion.status;
  const verificationUrl = result?.verificationUrl ?? signer.verificationUrl;
  const pdf = usePdfDocument(open.data && signer.status === 'pending' && !signedAt && !rejectedAt ? signingTaskSourceFileUrl(task.signerPublicId) : null);
  const block = signBlock(task, new Date());

  return (
    <>
      <BackButton href={signedAt ? '/my-signature?tab=signed' : rejectedAt ? '/my-signature?tab=rejected' : backHref(task)} />
      <PageHeader
        title={doc.title}
        description={[
          doc.docNumber,
          doc.createdBy && `建立人 ${doc.createdBy.name}（${doc.createdBy.employeeNo}）`,
          `${doc.isReopened ? '補簽期限' : '簽署期限'} ${formatDate(doc.signEndAt) ?? '不限'}`,
        ].filter(Boolean).join('・')}
      />
      {open.error ? (
        <Alert severity="error" action={<Button color="inherit" onClick={() => openTask(task.signerPublicId)}>重新載入</Button>}>
          無法開啟文件：{getErrorMessage(open.error)}
        </Alert>
      ) : !open.data ? <Loading /> : signedAt ? (
        <Stack spacing={2}>
          <Alert severity="success" variant="outlined" action={verificationUrl && (
            <Button variant="outlined" startIcon={<VerifiedRoundedIcon />} href={verificationUrl} target="_blank" rel="noopener noreferrer">
              查看簽章驗證
            </Button>
          )}>
            已於 {taipeiDateTime(signedAt)} 完成簽署。
          </Alert>
          {copyStatus === 'failed' ? (
            <Alert severity="error">已簽署文件暫時無法產生，您的簽署已完成並保存，請聯絡文件發起人。</Alert>
          ) : (
            <Box>
              <Button variant="contained" disabled={copyStatus !== 'ready' || download.isPending}
                loading={download.isPending} aria-busy={copyStatus !== 'ready' || download.isPending}
                onClick={() => download.mutate(task.signerPublicId)}
                startIcon={copyStatus === 'ready' ? <DownloadRoundedIcon /> : <CircularProgress size={20} color="inherit" />}>
                下載已簽署文件
              </Button>
              <Typography variant="helper" component="div" sx={{ mt: 1 }}>
                {copyStatus === 'ready' ? '下載您的個人簽署副本（PDF）。' : '文件產生中，完成後即可下載。'}
              </Typography>
            </Box>
          )}
        </Stack>
      ) : rejectedAt ? (
        <Alert severity="info" variant="outlined">
          已於 {taipeiDateTime(rejectedAt)} 拒絕簽署。
          <Typography variant="content" component="div">拒絕原因：{(rejection?.reason ?? signer.rejectReason) || '未填寫'}</Typography>
        </Alert>
      ) : block ? (
        <Alert severity="info" variant="outlined">{block}</Alert>
      ) : !consented ? (
        <>
          <SignSteps activeIndex={0} />
          <TermsStep kind="consent" docName={doc.title} terms={[task.consent.text]} version={task.consent.version}
            backHref="/my-signature" onAgree={() => { setConsented(true); window.scrollTo({ top: 0 }); }} />
        </>
      ) : pdf.error ? (
        <Alert severity="error">文件載入失敗，請重新整理頁面；若登入已過期，請從入口網重新進入。</Alert>
      ) : pdf.doc ? (
        <SigningForm task={task} pdf={pdf.doc}
          onSubmit={async (body) => {
            const signed = await submitSigningTaskSignatures(task.signerPublicId, body);
            setResult(signed);
            void queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_SIGNING_TASKS] });
          }}
          onReject={async (body) => {
            const rejected = await rejectSigningTask(task.signerPublicId, body);
            setRejection(rejected);
            void queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_SIGNING_TASKS] });
          }}
          onError={() => { /* API 錯誤及 session 過期交由全域 provider 顯示，不自動重新提交。 */ }}
        />
      ) : <Loading />}
    </>
  );
}
