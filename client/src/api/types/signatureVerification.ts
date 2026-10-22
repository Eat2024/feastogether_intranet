// 公開簽章驗證（server/src/features/esign/dto/signature-verification.dto.ts）；只含 Spec 04 FR-009 白名單欄位
import type { EsignDocumentStatus } from './esignDocuments';

/** employee_session：員工登入後簽署；email_invitation：外部簽署人以 Email 邀請與驗證碼簽署 */
export type EsignAuthenticationMethod = 'employee_session' | 'email_invitation';

/** GET signature-verifications/:code 的回應；查無、格式錯誤一律 404，資料不一致 409 */
export interface SignatureVerification {
  signature: {
    /** 發起時固定的簽署人完整姓名 */
    signerName: string;
    signedAt: string;
    authenticationMethod: EsignAuthenticationMethod;
  };
  document: {
    title: string;
    status: Exclude<EsignDocumentStatus, 'draft'>;
    /** 簽署當下原始 PDF 的 SHA-256 摘要 */
    signedSourceSha256: string;
    completedAt: string | null;
    stoppedAt: string | null;
    /** 只有已完成時有值：本人個人完成 PDF 的 SHA-256 摘要 */
    completedPdfSha256: string | null;
  };
}
