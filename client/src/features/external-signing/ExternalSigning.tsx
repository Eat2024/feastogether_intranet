'use client';

// 外部簽署頁：開啟任務 → 同意聲明 → 閱讀與簽名 → 送出 → 簽署完成（本人副本產生後可下載）。
// 外部存取 cookie 的 path 只限 /api/external-signing-task，頁面請求不會帶上，資料一律由瀏覽器呼叫取得。
import { useGetExternalSigningTaskQuery } from '@/api/queries';
import { rejectExternalTask, externalSourceFileUrl, openExternalSigningTask } from '@/api/requests';
import type { ExternalSignatureResult, ExternalSigningTask } from '@/api/types';
import RejectDialog from '@/features/my-signature/sign/RejectDialog';
import { ConfirmHeading } from '@/components/ConfirmDialog';
import PageHeader from '@/components/PageHeader';
import { usePdfDocument } from '@/features/forms/pdf/usePdf';
import { SIGN_STEPS } from '@/features/my-signature/sign/steps';
import TermsStep from '@/features/my-signature/sign/TermsStep';
import { getErrorMessage, isExternalAccessLost } from '@/lib/apiError';
import { dialog, radius } from '@/theme/tokens';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import LinkOffRoundedIcon from '@mui/icons-material/LinkOffRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import ExternalDone from './ExternalDone';
import ExternalSignForm from './ExternalSignForm';
import SignSteps from './SignSteps';
import { taipeiDate } from './taskForm';

const reload = () => window.location.reload();

/** signerPublicId：網址上的簽署人；與 cookie 所屬簽署人不同時（例如之後又開啟了另一封邀請）視為失效 */
export default function ExternalSigning({ signerPublicId }: { signerPublicId: string }) {
  const open = useMutation({
    mutationFn: openExternalSigningTask,
    // 錯誤顯示在頁面卡片上
    meta: { suppressGlobalErrorToast: true },
  });
  const { mutate: openTask } = open;
  // 開啟會記錄稽核：每次進入頁面只開啟一次（開發模式的 StrictMode 會重跑 effect）
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    openTask();
  }, [openTask]);

  const [rejectOpen, setRejectOpen] = useState(false);
  const rejectRequest = useRef<{ reason: string; requestId: string } | null>(null);
  const rejection = useMutation({ mutationFn: rejectExternalTask, onSuccess: () => setRejectOpen(false) });
  const task = open.data;
  // 開始閱讀聲明時就先讀取原始 PDF（頁數與頁面內容）
  const pdf = usePdfDocument(task?.signer.status === 'pending' ? externalSourceFileUrl() : null);
  const [consented, setConsented] = useState(false);
  const [result, setResult] = useState<ExternalSignatureResult | null>(null);
  const [accessLost, setAccessLost] = useState(false);
  // 剛送出成功，或任務本身已是已簽署（依 signer.status 決定流程，見 contracts/http-api.md）
  const signedAt = result?.signedAt ?? task?.signer.signedAt ?? null;
  // 簽署完成後以唯讀查詢取得本人副本的最新狀態（產生中時自動輪詢，不記錄開啟）
  const latest = useGetExternalSigningTaskQuery({ enabled: signedAt !== null });

  if (
    accessLost ||
    isExternalAccessLost(open.error) ||
    isExternalAccessLost(latest.error) ||
    [task, latest.data].some((current) => current && current.signerPublicId !== signerPublicId)
  ) {
    return <InvalidNotice />;
  }
  if (open.error) return <OpenErrorNotice message={getErrorMessage(open.error, '無法開啟文件，請稍後再試')} />;
  if (!task) return <Loading label="開啟文件中…" />;

  const rejectedAt = rejection.data?.rejectedAt ?? task.signer.rejectedAt;
  const content = rejectedAt ? (
    <Alert severity="info">已拒絕簽署 · {taipeiDate(rejectedAt)}<br />{rejection.data?.reason ?? task.signer.rejectReason ?? ''}</Alert>
  ) : signedAt ? (
    <>
      <SignSteps activeIndex={SIGN_STEPS.length} />
      <ExternalDone
        task={task}
        signedAt={signedAt}
        copyStatus={(latest.data?.signer ?? result ?? task.signer).completion.status}
      />
    </>
  ) : !consented ? (
    <>
      <SignSteps activeIndex={0} />
      <TermsStep
        kind="consent"
        docName={task.document.title}
        terms={[task.consent.text]}
        version={task.consent.version}
        onAgree={() => {
          setConsented(true);
          window.scrollTo({ top: 0 });
        }}
      />
    </>
  ) : pdf.doc ? (
    <ExternalSignForm task={task} pdf={pdf.doc} onSigned={setResult} onAccessLost={() => setAccessLost(true)} />
  ) : (
    // 看不到文件時不能簽名：載入失敗只提供重新整理
    <>
      <SignSteps activeIndex={1} />
      {pdf.error ? <PdfErrorAlert /> : <Loading label="載入文件中…" />}
    </>
  );

  return (
    <Stack spacing={{ xs: 2, sm: 3 }}>
      <PageHeader title={task.document.title} description={<SignerLine task={task} />} />
      {content}
      {!signedAt && !rejectedAt && task.allowReject && <Button color="error" onClick={() => setRejectOpen(true)} disabled={rejection.isPending}>拒絕簽署</Button>}
      <RejectDialog open={rejectOpen} docName={task.document.title} pending={rejection.isPending} onClose={() => setRejectOpen(false)} onConfirm={(rawReason) => {
        const reason = rawReason.trim();
        if (!rejectRequest.current || rejectRequest.current.reason !== reason) rejectRequest.current = { reason, requestId: crypto.randomUUID() };
        rejection.mutate({ signerPublicId, ...rejectRequest.current });
      }} />
    </Stack>
  );
}

/** 頁面說明只放本人姓名、Email（手機寬度省略）與簽署期限，不顯示其他簽署人或建立人 */
function SignerLine({ task }: { task: ExternalSigningTask }) {
  return (
    <>
      簽署人 {task.signer.name}
      <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
        （{task.signer.email}）
      </Box>
      ・簽署期限 {task.document.signEndAt ? taipeiDate(task.document.signEndAt) : '不限'}
    </>
  );
}

function PdfErrorAlert() {
  return (
    <Alert
      severity="error"
      action={
        <Button color="inherit" onClick={reload}>
          重新整理
        </Button>
      }
    >
      文件載入失敗，請重新整理頁面後再試。
    </Alert>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 8 }}>
      <CircularProgress size={20} />
      <Typography variant="description">{label}</Typography>
    </Box>
  );
}

/** 存取失效：與後端的「邀請連結無效或已到期」頁相同內容，不區分原因 */
function InvalidNotice() {
  return (
    <NoticeCard icon={<LinkOffRoundedIcon />} color="error" title="邀請連結無效或已到期">
      <Typography variant="description">如仍需要簽署這份文件，請聯絡文件發起人重新寄送邀請。</Typography>
      <Typography variant="helper" sx={{ mt: 1 }}>
        可能原因：已超過簽署期限、文件已停止簽署，或網址不完整。
      </Typography>
    </NoticeCard>
  );
}

/** 開啟任務的其他錯誤（例如簽署尚未開始、服務暫時無法使用）：顯示後端訊息，可重新整理再試 */
function OpenErrorNotice({ message }: { message: string }) {
  return (
    <NoticeCard icon={<ErrorOutlineRoundedIcon />} color="warning" title="無法開啟電子簽署文件">
      <Typography variant="description">{message}</Typography>
      <Button fullWidth size="large" variant="contained" sx={{ mt: 2 }} onClick={reload}>
        重新整理頁面
      </Button>
    </NoticeCard>
  );
}

/** 確認型卡片（與 ConfirmDialog 相同外觀），放在頁首下方 */
function NoticeCard({
  icon,
  color,
  title,
  children,
}: {
  icon: ReactNode;
  color: 'error' | 'warning';
  title: string;
  children: ReactNode;
}) {
  return (
    <Box
      component="section"
      sx={{
        alignSelf: 'center',
        width: dialog.widthConfirm,
        maxWidth: '100%',
        mt: 18,
        p: 3,
        bgcolor: 'background.paper',
        borderRadius: `${radius.dialogConfirm}px`,
        boxShadow: dialog.shadowConfirm,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1,
        textAlign: 'center',
      }}
    >
      <ConfirmHeading icon={icon} color={color} title={title} titleComponent="h1" />
      {children}
    </Box>
  );
}
