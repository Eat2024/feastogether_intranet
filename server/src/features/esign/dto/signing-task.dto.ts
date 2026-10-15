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
}
