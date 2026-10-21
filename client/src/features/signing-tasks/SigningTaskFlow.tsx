'use client';

// 簽署流程（後端文件）：與 mock 版 SignFlow、外部簽署共用 TermsStep、DocumentViewer、SignProgressPanel 與 useSignaturePad。
// 同意告知後呼叫 POST /api/esign/signing-tasks/:id 記錄開啟文件，確認送出時呼叫 POST .../signatures。
import { queryKeys } from '@/api/query-keys';
import { openSigningTask, signingTaskSourceFileUrl, submitSignatures } from '@/api/requests';
import type { EsignSigningTask } from '@/api/types';
import ConfirmDialog from '@/components/ConfirmDialog';
import StepFlow from '@/components/StepFlow';
import { fromFieldView } from '@/features/esign-documents/fields';
import { usePdfDocument } from '@/features/forms/pdf/usePdf';
import { signFieldLabel, signFields, type SignLayout } from '@/features/forms/signLayout';
import DocumentViewer from '@/features/my-signature/sign/DocumentViewer';
import SignaturePadDialog from '@/features/my-signature/sign/SignaturePadDialog';
import SignProgressPanel from '@/features/my-signature/sign/SignProgressPanel';
import { SIGN_STEPS } from '@/features/my-signature/sign/steps';
import TermsStep from '@/features/my-signature/sign/TermsStep';
import { useSignaturePad } from '@/features/my-signature/sign/useSignaturePad';
import { getErrorMessage } from '@/lib/apiError';
import { newSignatureId } from '@/lib/signatureQr';
import DrawRoundedIcon from '@mui/icons-material/DrawRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useRouter } from 'next/navigation';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useMemo, useRef, useState } from 'react';

export default function SigningTaskFlow({ task }: { task: EsignSigningTask }) {
  // 頁數以實際 PDF 為準（任務資料沒有頁數）
  const { doc, error, loading } = usePdfDocument(signingTaskSourceFileUrl(task.signerPublicId));

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 8 }}>
        <CircularProgress size={20} />
        <Typography variant="description">載入文件中…</Typography>
      </Box>
    );
  }
  if (error || !doc) {
    return (
      <Alert severity="error" variant="outlined">
        無法讀取文件內容，請重新整理後再試；若仍無法讀取，請聯絡建立人。
      </Alert>
    );
  }
  return <SignForm task={task} pdf={doc} />;
}

/** 同意告知 → 閱讀文件 → 逐一完成簽名 → 確認送出 */
function SignForm({ task, pdf }: { task: EsignSigningTask; pdf: PDFDocumentProxy }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  // 欄位 id 沿用後端欄位 id，送出時原樣帶回（與外部簽署相同）
  const layout: SignLayout = useMemo(
    () => ({
      pageCount: pdf.numPages,
      originalPages: pdf.numPages,
      confirmPage: null,
      fields: task.fields.map((f) => fromFieldView(f, Number(f.id))),
    }),
    [pdf.numPages, task.fields],
  );
  const fields = signFields(layout);

  // 每次進入簽署都須重新同意告知（不保留先前的同意）
  const [consented, setConsented] = useState(false);
  const {
    readAgreed,
    setReadAgreed,
    signatures,
    activePage,
    setActivePage,
    padField,
    openPad,
    closePad,
    confirmSignature: confirmPadSignature,
    activeStep,
  } = useSignaturePad(fields, fields[0]?.page ?? 1);
  // 簽名旁的 QR code 為示意佔位；實際的簽章驗證 QR code 由後端產生在每份個人簽署副本中
  const [signatureIds, setSignatureIds] = useState<Record<number, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  // 送出中：點擊當下就停用按鈕，避免連點送出兩次
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // 日期欄位由後端在送出時填入，畫面先顯示開始簽署當天的日期
  const [today] = useState(() => dayjs().format('YYYY/MM/DD'));
  // 同一組簽名重送時沿用 requestId（後端依此判斷重複送出）；簽名改變後換新的
  const lastRequest = useRef<{ signatures: Record<number, string>; requestId: string } | null>(null);

  // 錯誤顯示在簽署畫面上，不另外跳全域提示（401 仍會顯示登入過期）
  const open = useMutation({ mutationFn: openSigningTask, meta: { suppressGlobalErrorToast: true } });
  const sign = useMutation({
    mutationFn: submitSignatures,
    meta: { suppressGlobalErrorToast: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_SIGNING_TASKS] });
      // 建立人同時也可能是簽署人：電子簽列表的進度一併更新
      void queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_DOCUMENTS] });
      router.push('/my-signature?tab=signed&flash=signed');
    },
    onError: (err) => {
      setError(getErrorMessage(err, '簽署失敗，請稍後再試'));
      setBusy(false);
      setConfirmOpen(false);
    },
  });

  const agree = () => {
    setError(undefined);
    open.mutate(task.signerPublicId, {
      onSuccess: () => {
        setConsented(true);
        window.scrollTo({ top: 0 });
      },
      onError: (err) => setError(getErrorMessage(err, '無法開啟文件，請稍後再試')),
    });
  };

  const confirmSignature = (dataUrl: string) => {
    if (!padField) return;
    // 每次確認簽名都產生新的識別碼（重新簽名即換新）
    setSignatureIds((prev) => ({ ...prev, [padField.id]: newSignatureId() }));
    confirmPadSignature(dataUrl);
  };

  const submit = () => {
    if (busy) return;
    setBusy(true);
    if (lastRequest.current?.signatures !== signatures) {
      lastRequest.current = { signatures, requestId: crypto.randomUUID() };
    }
    sign.mutate({
      signerPublicId: task.signerPublicId,
      body: {
        requestId: lastRequest.current.requestId,
        consentVersion: task.consent.version,
        accepted: true,
        signatures: fields.map((f) => ({ fieldId: String(f.id), pngDataUrl: signatures[f.id] })),
      },
    });
  };

  const errorAlert = error && (
    <Alert severity="error" onClose={() => setError(undefined)}>
      {error}
    </Alert>
  );

  if (!consented) {
    return (
      <Stack spacing={3}>
        <StepFlow steps={SIGN_STEPS} activeIndex={0} />
        {errorAlert}
        <TermsStep
          docName={task.document.title}
          // 後端提供的告知內容；送出時帶回同一個版本
          terms={[task.consent.text]}
          version={task.consent.version}
          kind="consent"
          backHref="/my-signature"
          agreeing={open.isPending}
          onAgree={agree}
        />
      </Stack>
    );
  }

  return (
    <Stack spacing={3}>
      <StepFlow steps={SIGN_STEPS} activeIndex={activeStep} />
      {errorAlert}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 300px' },
          gap: 3,
          alignItems: 'start',
        }}
      >
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 2, minWidth: 0 }}>
          <DocumentViewer
            docInfo={{ name: task.document.title, docNumber: task.document.docNumber }}
            pdfUrl={null}
            signer={{ name: task.signer.name, employeeNo: task.signer.employeeNo ?? '' }}
            layout={layout}
            signatures={signatures}
            signatureIds={signatureIds}
            dateText={today}
            activePage={activePage}
            onPageChange={setActivePage}
            onSignField={busy ? undefined : openPad}
            pdfDoc={pdf}
          />
        </Paper>

        <SignProgressPanel
          layout={layout}
          signatures={signatures}
          readAgreed={readAgreed}
          onReadAgreedChange={setReadAgreed}
          busy={busy}
          onFieldClick={openPad}
          onConfirm={() => setConfirmOpen(true)}
          // TODO: 改為呼叫後端 POST /api/esign/signing-tasks/:id/rejection（任務的 allowReject 決定是否顯示）
          rejectUnavailable="後端尚未支援拒絕簽署"
        />
      </Box>

      <SignaturePadDialog
        open={!!padField}
        subtitle={padField ? `${task.document.title}・${signFieldLabel(layout, padField)}` : ''}
        onClose={closePad}
        onConfirm={confirmSignature}
      />
      <ConfirmDialog
        open={confirmOpen}
        icon={<DrawRoundedIcon />}
        title="確認簽署此文件？"
        description={`「${task.document.title}」送出後即完成簽署，無法修改或撤回。`}
        confirmLabel="確認簽署"
        loading={busy}
        onConfirm={submit}
        onClose={() => !busy && setConfirmOpen(false)}
      />
    </Stack>
  );
}
