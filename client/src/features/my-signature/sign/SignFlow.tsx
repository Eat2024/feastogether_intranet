'use client';

import ConfirmDialog from '@/components/ConfirmDialog';
import StepFlow from '@/components/StepFlow';
import { formOptions } from '@/features/forms/options';
import { getSignLayout, signFieldLabel, signFields } from '@/features/forms/signLayout';
import type { EFormDoc, Signer, UploadField } from '@/features/forms/types';
import DrawRoundedIcon from '@mui/icons-material/DrawRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import { newSignatureId } from '@/lib/signatureQr';
import { useState, useTransition } from 'react';
import { rejectDocument, signDocument } from '../actions';
import DocumentViewer from './DocumentViewer';
import RejectDialog from './RejectDialog';
import SignaturePadDialog from './SignaturePadDialog';
import SignProgressPanel from './SignProgressPanel';
import TermsStep from './TermsStep';
import { SIGN_TERMS, SIGN_TERMS_VERSION } from './terms';

export const SIGN_STEPS = ['同意授權條款', '閱讀文件', '完成簽名', '確認送出'];

const nowStr = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** 簽署流程：同意授權條款 → 閱讀文件 → 逐一完成簽名 → 確認送出 */
export default function SignFlow({ form, me, today }: { form: EFormDoc; me: Signer; today: string }) {
  const layout = getSignLayout(form)!;
  const fields = signFields(layout);

  // 每次進入簽署都須重新同意條款（不保留先前的同意）
  const [consent, setConsent] = useState<{ version: string; agreedAt: string } | null>(null);
  const [readAgreed, setReadAgreed] = useState(false);
  const [signatures, setSignatures] = useState<Record<number, string>>({});
  // 每次確認簽名都產生新的識別碼（重新簽名即換新）
  const [signatureIds, setSignatureIds] = useState<Record<number, string>>({});
  const [activePage, setActivePage] = useState(1);
  const [padField, setPadField] = useState<UploadField | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'sign' | 'reject' | null>(null);
  const [error, setError] = useState<string>();
  const [, startTransition] = useTransition();

  const allSigned = fields.every((f) => signatures[f.id]);
  const activeStep = !consent ? 0 : !readAgreed ? 1 : !allSigned ? 2 : 3;

  const openPad = (f: UploadField) => {
    setActivePage(f.page);
    setPadField(f);
  };

  const confirmSignature = (dataUrl: string) => {
    if (!padField) return;
    const next = { ...signatures, [padField.id]: dataUrl };
    setSignatures(next);
    setSignatureIds((prev) => ({ ...prev, [padField.id]: newSignatureId() }));
    setPadField(null);
    // 自動切到下一個尚未簽名的欄位所在頁面（不自動開啟簽名板）
    const nextField = fields.find((f) => !next[f.id]);
    if (nextField) setActivePage(nextField.page);
  };

  const submitSign = () => {
    if (!consent) return;
    setPendingAction('sign');
    startTransition(async () => {
      const result = await signDocument({ formId: form.id, signatures, signatureIds, consent });
      if (result?.error) {
        setError(result.error);
        setPendingAction(null);
        setConfirmOpen(false);
      }
    });
  };

  const submitReject = (reason: string) => {
    setPendingAction('reject');
    startTransition(async () => {
      const result = await rejectDocument({ formId: form.id, reason });
      if (result?.error) {
        setError(result.error);
        setPendingAction(null);
        setRejectOpen(false);
      }
    });
  };

  if (!consent) {
    return (
      <Stack spacing={3}>
        <StepFlow steps={SIGN_STEPS} activeIndex={0} />
        <TermsStep
          docName={form.name}
          terms={SIGN_TERMS}
          version={SIGN_TERMS_VERSION}
          backHref="/my-signature"
          onAgree={() => {
            setConsent({ version: SIGN_TERMS_VERSION, agreedAt: nowStr() });
            window.scrollTo({ top: 0 });
          }}
        />
      </Stack>
    );
  }

  const busy = pendingAction !== null;

  return (
    <Stack spacing={3}>
      <StepFlow steps={SIGN_STEPS} activeIndex={activeStep} />
      {error && (
        <Alert severity="error" onClose={() => setError(undefined)}>
          {error}
        </Alert>
      )}

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
            form={form}
            signer={me}
            layout={layout}
            signatures={signatures}
            signatureIds={signatureIds}
            dateText={today}
            activePage={activePage}
            onPageChange={setActivePage}
            onSignField={busy ? undefined : openPad}
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
          // 建立人可在設定簽署時關閉拒絕簽署；server 端也會再檢查
          onReject={formOptions(form).allowReject ? () => setRejectOpen(true) : undefined}
        />
      </Box>

      <SignaturePadDialog
        open={!!padField}
        subtitle={padField ? `${form.name}・${signFieldLabel(layout, padField)}` : ''}
        onClose={() => setPadField(null)}
        onConfirm={confirmSignature}
      />
      <ConfirmDialog
        open={confirmOpen}
        icon={<DrawRoundedIcon />}
        title="確認簽署此文件？"
        description={`「${form.name}」送出後即完成簽署，無法修改或撤回。`}
        confirmLabel={pendingAction === 'sign' ? '送出中…' : '確認簽署'}
        onConfirm={() => !busy && submitSign()}
        onClose={() => !busy && setConfirmOpen(false)}
      />
      <RejectDialog
        open={rejectOpen}
        docName={form.name}
        pending={pendingAction === 'reject'}
        onClose={() => setRejectOpen(false)}
        onConfirm={submitReject}
      />
    </Stack>
  );
}
