export type EsignDocumentStatus =
  | 'draft'
  | 'active'
  | 'finalizing'
  | 'completed'
  | 'stopped';

export type EsignSignerType = 'user' | 'email';
export type EsignSignerStatus = 'pending' | 'signed';
export type EsignFieldType = 'signature' | 'date';
export type EsignInvitationDelivery = 'pending' | 'delivered' | 'failed';

export class EsignDocumentSummaryDto {
  id!: string;
  docNumber!: string;
  title!: string;
  status!: EsignDocumentStatus;
  createdAt!: string;
  initiatedAt!: string | null;
  completedAt!: string | null;
  stoppedAt!: string | null;
  pendingCount!: number;
  signedCount!: number;
}

export class EsignSourceFileDto {
  fileName!: string;
  size!: number;
  pageCount!: number;
  sha256!: string;
}

export class EsignSignerViewDto {
  publicId!: string;
  type!: EsignSignerType;
  name!: string;
  employeeNo!: string | null;
  department!: string | null;
  title!: string | null;
  email!: string | null;
  status!: EsignSignerStatus;
  signedAt!: string | null;
  invitationDelivery!: EsignInvitationDelivery | null;
}

export class EsignFieldViewDto {
  id!: string;
  signerPublicId!: string;
  type!: EsignFieldType;
  page!: number;
  xPercent!: number;
  yPercent!: number;
  widthPercent!: number;
  heightPercent!: number;
  sortOrder!: number;
}

export class EsignDocumentDetailDto extends EsignDocumentSummaryDto {
  sourceFile?: EsignSourceFileDto;
  signStartAt!: string | null;
  signEndAt!: string | null;
  stopReason!: string | null;
  signers!: EsignSignerViewDto[];
  fields!: EsignFieldViewDto[];
}

export class EsignHistoryItemDto {
  type!: string;
  occurredAt!: string;
  actor!: string | null;
  reason!: string | null;
}
