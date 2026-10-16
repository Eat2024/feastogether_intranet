import type {
  EsignDocumentSummaryDto,
  EsignFieldViewDto,
  EsignSignerViewDto,
} from './esign-common.dto';

export class EsignConsentViewDto {
  version!: string;
  text!: string;
  sha256!: string;
}

export class EsignSigningTaskDto {
  signerPublicId!: string;
  document!: EsignDocumentSummaryDto;
  signer!: EsignSignerViewDto;
  fields!: EsignFieldViewDto[];
  consent!: EsignConsentViewDto;
  pendingCount!: number;
  signedCount!: number;
}

export class EsignSignatureResultDto {
  signerPublicId!: string;
  signedAt!: string;
  documentStatus!: 'active' | 'finalizing' | 'completed';
  /** 本次簽章的公開驗證網址；重送相同請求時相同 */
  verificationUrl!: string;
}
