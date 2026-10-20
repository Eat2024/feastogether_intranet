// 外部簽署人（server/src/features/esign/services/external-access.service.ts、dto/signature-submission.dto.ts）
import type { EsignDocumentStatus, EsignFieldView, EsignSignerView } from './esignDocuments';

/** POST／GET external-signing-task：外部存取 cookie 所屬簽署人的簽署任務（不含其他簽署人與建立人資料） */
export interface ExternalSigningTask {
  signerPublicId: string;
  document: { id: string; title: string; status: EsignDocumentStatus; signEndAt: string | null };
  signer: Pick<EsignSignerView, 'publicId' | 'type' | 'name' | 'email' | 'status' | 'signedAt' | 'completion'>;
  /** 文件的共用欄位，每位簽署人都要簽 */
  fields: EsignFieldView[];
  /** 目前有效的電子簽署同意聲明；送出時帶回 version */
  consent: { version: string; text: string; sha256: string };
}

/** POST external-signing-task/signatures */
export interface SubmitExternalSignaturesBody {
  /** UUID v4；同一次送出的重試沿用同一個，後端據此辨識重送 */
  requestId: string;
  consentVersion: string;
  accepted: true;
  /** 每個簽名欄位一筆（日期欄位由後端以簽署時間帶入） */
  signatures: { fieldId: string; pngDataUrl: string }[];
}

/** POST external-signing-task/signatures 的簽署結果（重送同一 requestId 回相同結果） */
export interface ExternalSignatureResult {
  signerPublicId: string;
  signedAt: string;
  documentStatus: EsignDocumentStatus;
  completion: EsignSignerView['completion'];
}
