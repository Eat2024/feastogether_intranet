'use client';

import ConfirmDialog from '@/components/ConfirmDialog';
import { signFieldLabel, signFields } from '@/features/forms/signLayout';
import DocumentViewer from '@/features/my-signature/sign/DocumentViewer';
import RejectDialog from '@/features/my-signature/sign/RejectDialog';
import SignaturePadDialog from '@/features/my-signature/sign/SignaturePadDialog';
import SignProgressPanel from '@/features/my-signature/sign/SignProgressPanel';
import { useSignaturePad } from '@/features/my-signature/sign/useSignaturePad';
import DrawRoundedIcon from '@mui/icons-material/DrawRounded';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import { useMutation } from '@tanstack/react-query';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useRef, useState } from 'react';
import SignSteps from './SignSteps';
import { taipeiDate, toSignLayout, toSubmission, toViewerForm, type SigningFormTask, type SignatureSubmission, type RejectionSubmission } from './signingTaskForm';

// md 以下簽名進度面板固定在畫面底部：內容底部預留面板最高時的高度（spacing 單位，26 × 8 = 208px），避免文件被蓋住
const MOBILE_PANEL_SPACE = 26;

export type SigningFormProps = {
  task: SigningFormTask;
  /** 已讀取的原始 PDF（頁數與頁面內容） */
  pdf: PDFDocumentProxy;
  onSubmit: (body: SignatureSubmission) => Promise<unknown>;
  onReject: (body: RejectionSubmission) => Promise<unknown>;
  onError: (error: Error) => void;
};

/** 切換簽署人時卸載舊表單，清除手寫簽名、聲明勾選與重試識別。 */
export default function SigningForm(props: SigningFormProps) {
  return <SigningFormContent key={props.task.signerPublicId} {...props} />;
}

/** 閱讀與簽名：容器提供 API callback，表單不決定認證方式。 */
function SigningFormContent({ task, pdf, onSubmit, onReject, onError: reportError }: SigningFormProps) {
  const layout = toSignLayout(task, pdf.numPages);
  const fields = signFields(layout);
  // 先停在第一個需要簽名的頁面
  const {
    readAgreed,
    setReadAgreed,
    signatures,
    activePage,
    setActivePage,
    padField,
    openPad,
    closePad,
    confirmSignature,
    activeStep,
  } = useSignaturePad(fields, fields[0]?.page ?? 1);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // 日期欄位顯示開始簽署當天的日期；實際寫入 PDF 的日期以後端簽署時間為準
  const [today] = useState(() => taipeiDate(new Date()));
  // 這次簽署的識別：送出失敗後重試沿用同一個，後端據此辨識重送，不會重複簽署
  const [requestId] = useState(() => crypto.randomUUID());
  // ref 同步攔截連點，state 負責更新送出中的畫面。
  const [busy, setBusy] = useState<'sign' | 'reject' | null>(null);
  const submitting = useRef(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  // 拒絕的識別：同一個原因重送時沿用，原因改變後換新的（後端只把相同 requestId 且相同原因視為重送）
  const lastRejection = useRef<{ reason: string; requestId: string } | null>(null);
  // 失敗後保留確認視窗與 requestId；認證失效交由容器處理。
  const onError = (error: Error) => {
    submitting.current = false;
    setBusy(null);
    reportError(error);
  };
  const submit = useMutation({ mutationFn: onSubmit, onError });
  const reject = useMutation({ mutationFn: onReject, onError });

  const confirmSubmit = () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy('sign');
    submit.mutate(toSubmission(task, layout, signatures, requestId));
  };

  const confirmReject = (input: string) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy('reject');
    const reason = input.trim();
    if (lastRejection.current?.reason !== reason) {
      lastRejection.current = { reason, requestId: crypto.randomUUID() };
    }
    reject.mutate({ requestId: lastRejection.current.requestId, reason });
  };

  return (
    <Stack spacing={3} sx={{ pb: { xs: MOBILE_PANEL_SPACE, md: 0 } }}>
      <SignSteps activeIndex={activeStep} />
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 300px' },
          gap: 3,
          alignItems: 'start',
        }}
      >
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, borderRadius: 2, minWidth: 0 }}>
          <DocumentViewer
            docInfo={toViewerForm(task)}
            pdfUrl={null}
            // 電子簽文件使用原始 PDF 欄位，沒有系統簽署確認頁
            signer={{ name: task.signer.name, employeeNo: '' }}
            layout={layout}
            signatures={signatures}
            // 簽名旁顯示驗證 QR Code 的示意佔位圖；真正的 QR Code 由後端在簽署成功後產生於本人副本（Spec 04 FR-004）
            qrPlaceholder
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
          busy={busy !== null}
          onFieldClick={openPad}
          onConfirm={() => setConfirmOpen(true)}
          // 建立人發起時可關閉拒絕簽署；送出時後端會再檢查
          onReject={task.allowReject ? () => setRejectOpen(true) : undefined}
          fixedOnMobile
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
        loading={busy === 'sign'}
        onConfirm={confirmSubmit}
        onClose={() => setConfirmOpen(false)}
      />
      <RejectDialog
        open={rejectOpen}
        docName={task.document.title}
        pending={busy === 'reject'}
        onClose={() => setRejectOpen(false)}
        onConfirm={confirmReject}
      />
    </Stack>
  );
}
