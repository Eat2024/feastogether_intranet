'use client';

// 簽署流程（後端文件）：畫面沿用 SignFlowView。
// 同意告知後呼叫 POST /api/esign/signing-tasks/:id 記錄開啟文件，確認送出時呼叫 POST .../signatures。
import { queryKeys } from '@/api/query-keys';
import { openSigningTask, signingTaskSourceFileUrl, submitSignatures } from '@/api/requests';
import type { EsignSigningTask } from '@/api/types';
import { fromFieldViews } from '@/features/esign-documents/fields';
import type { SignLayout } from '@/features/forms/signLayout';
import { usePdfDocument } from '@/features/forms/pdf/usePdf';
import SignFlowView, { type SignSubmission } from '@/features/my-signature/sign/SignFlowView';
import { getErrorMessage } from '@/lib/apiError';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useRouter } from 'next/navigation';
import { useMemo, useRef } from 'react';

export default function SigningTaskFlow({ task }: { task: EsignSigningTask }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  // 頁數以實際 PDF 為準（任務資料沒有頁數）
  const { doc, error, loading } = usePdfDocument(signingTaskSourceFileUrl(task.signerPublicId));

  // 共用欄位依 sortOrder 排序，畫面的欄位 id 為流水號（第 i 個欄位的 id 為 i + 1），送出時換回後端的欄位 id
  const { fields, fieldIds } = useMemo(() => {
    const sorted = [...task.fields].sort((a, b) => a.sortOrder - b.sortOrder);
    return { fields: fromFieldViews(sorted), fieldIds: sorted.map((f) => f.id) };
  }, [task.fields]);

  // 同一組簽名重送時沿用 requestId（後端依此判斷重複送出）；簽名改變後換新的
  const lastRequest = useRef<{ signatures: SignSubmission['signatures']; requestId: string } | null>(null);

  // 錯誤顯示在簽署畫面上，不另外跳全域提示（401 仍會顯示登入過期）
  const open = useMutation({ mutationFn: openSigningTask, meta: { suppressGlobalErrorToast: true } });
  const sign = useMutation({ mutationFn: submitSignatures, meta: { suppressGlobalErrorToast: true } });

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

  const layout: SignLayout = { pageCount: doc.numPages, originalPages: doc.numPages, confirmPage: null, fields };

  const onStart = async () => {
    try {
      await open.mutateAsync(task.signerPublicId);
      return null;
    } catch (err) {
      return getErrorMessage(err, '無法開啟文件，請稍後再試');
    }
  };

  const onSign = async ({ signatures }: SignSubmission) => {
    if (lastRequest.current?.signatures !== signatures) {
      lastRequest.current = { signatures, requestId: crypto.randomUUID() };
    }
    try {
      await sign.mutateAsync({
        signerPublicId: task.signerPublicId,
        body: {
          requestId: lastRequest.current.requestId,
          consentVersion: task.consent.version,
          accepted: true,
          signatures: Object.entries(signatures).map(([id, pngDataUrl]) => ({
            fieldId: fieldIds[Number(id) - 1],
            pngDataUrl,
          })),
        },
      });
    } catch (err) {
      return getErrorMessage(err, '簽署失敗，請稍後再試');
    }
    void queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_SIGNING_TASKS] });
    // 建立人同時也可能是簽署人：電子簽列表的進度一併更新
    void queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_DOCUMENTS] });
    router.push('/my-signature?tab=signed&flash=signed');
    return null;
  };

  return (
    <SignFlowView
      docInfo={{ name: task.document.title, docNumber: task.document.docNumber }}
      pdfUrl={null}
      pdfDoc={doc}
      signer={{ name: task.signer.name, employeeNo: task.signer.employeeNo ?? '' }}
      layout={layout}
      // 日期欄位由後端在送出時填入，畫面先顯示今天
      today={dayjs().format('YYYY/MM/DD')}
      // 後端提供的告知內容；送出時帶回同一個版本
      terms={[task.consent.text]}
      termsVersion={task.consent.version}
      // 簽名旁的 QR code 為示意佔位；實際的簽章驗證 QR code 由後端產生在每份個人簽署副本中
      onStart={onStart}
      onSign={onSign}
      // TODO: 後端支援拒絕簽署後改為 onReject 呼叫 API
      rejectUnavailable="後端尚未支援拒絕簽署"
    />
  );
}
