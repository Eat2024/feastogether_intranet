'use client';

import { rejectExternalSigningTask, submitExternalSignatures } from '@/api/requests';
import type { ExternalRejectionResult, ExternalSignatureResult, ExternalSigningTask } from '@/api/types';
import SigningForm from '@/features/my-signature/sign/SigningForm';
import { getInternalPortalLoginUrl, isExternalAccessLost } from '@/lib/apiError';
import type { PDFDocumentProxy } from 'pdfjs-dist';

type ExternalSignFormProps = {
  task: ExternalSigningTask;
  pdf: PDFDocumentProxy;
  onSigned: (result: ExternalSignatureResult) => void;
  onRejected: (result: ExternalRejectionResult) => void;
  onAccessLost: () => void;
  onInternalLoginRequired: (url: string) => void;
};

/** 外部容器保留 cookie API、簽署人核對與邀請失效處理。 */
export default function ExternalSignForm({ task, pdf, onSigned, onRejected, onAccessLost, onInternalLoginRequired }: ExternalSignFormProps) {
  return (
    <SigningForm
      task={task}
      pdf={pdf}
      onSubmit={async (body) => {
        const result = await submitExternalSignatures({ ...body, signerPublicId: task.signerPublicId });
        onSigned(result);
      }}
      onReject={async (body) => {
        const result = await rejectExternalSigningTask({ ...body, signerPublicId: task.signerPublicId });
        onRejected(result);
      }}
      onError={(error) => {
        const portalUrl = getInternalPortalLoginUrl(error);
        if (portalUrl) onInternalLoginRequired(portalUrl);
        else if (isExternalAccessLost(error)) onAccessLost();
      }}
    />
  );
}
