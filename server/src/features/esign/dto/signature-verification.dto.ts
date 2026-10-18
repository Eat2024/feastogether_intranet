import type { EsignDocumentStatus } from './esign-common.dto';

export type EsignAuthenticationMethod = 'employee_session' | 'email_invitation';

/** 公開驗證只揭露的簽章欄位（spec FR-009 白名單） */
export class SignatureVerificationSignatureDto {
  /** 發起時固定的簽署人完整姓名 */
  signerName!: string;
  signedAt!: string;
  authenticationMethod!: EsignAuthenticationMethod;
}

export class SignatureVerificationDocumentDto {
  title!: string;
  status!: Exclude<EsignDocumentStatus, 'draft'>;
  /** 簽署當下重算的原始 PDF 摘要 */
  signedSourceSha256!: string;
  completedAt!: string | null;
  stoppedAt!: string | null;
  /** 只有 completed 時有值，等於 manifest v2 本人項目及個人完成 PDF 的摘要 */
  completedPdfSha256!: string | null;
}

export class SignatureVerificationDto {
  signature!: SignatureVerificationSignatureDto;
  document!: SignatureVerificationDocumentDto;
}
