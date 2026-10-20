'use client';

import { submitExternalSignatures } from '@/api/requests';
import type { ExternalSignatureResult, ExternalSigningTask } from '@/api/types';
import ConfirmDialog from '@/components/ConfirmDialog';
import { signFieldLabel, signFields } from '@/features/forms/signLayout';
import DocumentViewer from '@/features/my-signature/sign/DocumentViewer';
import SignaturePadDialog from '@/features/my-signature/sign/SignaturePadDialog';
import SignProgressPanel from '@/features/my-signature/sign/SignProgressPanel';
import { useSignaturePad } from '@/features/my-signature/sign/useSignaturePad';
import { isExternalAccessLost } from '@/lib/apiError';
import DrawRoundedIcon from '@mui/icons-material/DrawRounded';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import { useMutation } from '@tanstack/react-query';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useState } from 'react';
import SignSteps from './SignSteps';
import { taipeiDate, toSignLayout, toSubmission, toViewerForm } from './taskForm';

// md 以下簽名進度面板固定在畫面底部：內容底部預留面板最高時的高度（spacing 單位，26 × 8 = 208px），避免文件被蓋住
const MOBILE_PANEL_SPACE = 26;

type ExternalSignFormProps = {
  task: ExternalSigningTask;
  /** 已讀取的原始 PDF（頁數與頁面內容） */
  pdf: PDFDocumentProxy;
  onSigned: (result: ExternalSignatureResult) => void;
  onAccessLost: () => void;
};

/** 閱讀與簽名：逐頁閱讀文件、每個簽名欄位親手簽名，勾選同意後確認送出；外部簽署人不提供拒絕簽署 */
export default function ExternalSignForm({ task, pdf, onSigned, onAccessLost }: ExternalSignFormProps) {
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
  // 送出中：用 React state 在點擊當下就停用按鈕（mutation 的 isPending 要到下一個 tick 才更新，連點會送出兩次）
  const [busy, setBusy] = useState(false);
  const submit = useMutation({
    mutationFn: submitExternalSignatures,
    onSuccess: onSigned,
    // 其他錯誤（含 cookie 被其他邀請覆蓋時的「簽署對象已變更」）由全域 Snackbar 顯示後端訊息；確認視窗維持開啟，可直接再按一次重試
    onError: (error) => {
      setBusy(false);
      if (isExternalAccessLost(error)) onAccessLost();
    },
  });

  const confirmSubmit = () => {
    if (busy) return;
    setBusy(true);
    submit.mutate(toSubmission(task, layout, signatures, requestId));
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
            form={toViewerForm(task)}
            // 員工編號只用於系統簽署確認頁，外部文件沒有確認頁
            signer={{ name: task.signer.name, employeeNo: '' }}
            layout={layout}
            signatures={signatures}
            dateText={today}
            activePage={activePage}
            onPageChange={setActivePage}
            onSignField={busy ? undefined : openPad}
            pdf={pdf}
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
        loading={busy}
        onConfirm={confirmSubmit}
        onClose={() => setConfirmOpen(false)}
      />
    </Stack>
  );
}
