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

export class EsignDocumentCreatorDto {
  name!: string;
  employeeNo!: string;
}

/** 文件列表項目：摘要再加上簽署期間與建立人（僅供員工 session 的列表使用） */
export class EsignDocumentListItemDto extends EsignDocumentSummaryDto {
  signStartAt!: string | null;
  signEndAt!: string | null;
  /** 建立人帳號不存在時為 null */
  createdBy!: EsignDocumentCreatorDto | null;
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
  /** 草稿欄位尚未指派簽署人時為 null */
  signerPublicId!: string | null;
  type!: EsignFieldType;
  page!: number;
  xPercent!: number;
  yPercent!: number;
  widthPercent!: number;
  heightPercent!: number;
  sortOrder!: number;
}

export class EsignDocumentDetailDto extends EsignDocumentSummaryDto {
  /** 建立人帳號不存在時為 null */
  createdBy!: EsignDocumentCreatorDto | null;
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
