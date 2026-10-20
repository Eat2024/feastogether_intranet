export type EsignDocumentStatus =
  | 'draft'
  | 'active'
  | 'expired'
  | 'finalizing'
  | 'completed'
  | 'stopped';

export type EsignSignerType = 'user' | 'email';
export type EsignSignerStatus = 'pending' | 'signed' | 'rejected';
export type EsignFieldType = 'signature' | 'date';
export type EsignInvitationDelivery = 'pending' | 'delivered' | 'failed';

export class EsignDocumentSummaryDto {
  id!: string;
  docNumber!: string;
  title!: string;
  status!: EsignDocumentStatus;
  signEndAt!: string | null;
  originalSignEndAt!: string | null;
  isReopened!: boolean;
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
  /** 建立人帳號不存在時為 null */
  createdBy!: EsignDocumentCreatorDto | null;
}

export class EsignSourceFileDto {
  fileName!: string;
  size!: number;
  pageCount!: number;
  sha256!: string;
}

export class PersonalCompletionDto {
  status!: 'pending' | 'processing' | 'ready' | 'failed' | null;
  readyAt!: string | null;
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
  rejectedAt!: string | null;
  rejectReason!: string | null;
  completion!: PersonalCompletionDto;
  invitationDelivery!: EsignInvitationDelivery | null;
  /** 簽章公開驗證網址；只有 status = signed 時有值 */
  verificationUrl!: string | null;
}

export class EsignFieldViewDto {
  id!: string;
  type!: EsignFieldType;
  page!: number;
  xPercent!: number;
  yPercent!: number;
  widthPercent!: number;
  heightPercent!: number;
  sortOrder!: number;
}

/** 管理欄位不加入共用本人 DTO。 */
export class EsignManagedSignerViewDto extends EsignSignerViewDto {
  note!: string;
  latestInvitation!: {
    status: string;
    completedAt: string | null;
    reasonCode: string | null;
  } | null;
  latestReminder!: {
    status: string;
    completedAt: string | null;
    reasonCode: string | null;
  } | null;
  deliveredReminderCount!: number;
  reminderEligibility!: {
    eligible: boolean;
    reasonCode: string | null;
    nextEligibleAt: string | null;
  };
}

export class EsignDocumentDetailDto extends EsignDocumentSummaryDto {
  /** 建立人帳號不存在時為 null */
  createdBy!: EsignDocumentCreatorDto | null;
  sourceFile?: EsignSourceFileDto;
  signStartAt!: string | null;
  stopReason!: string | null;
  signers!: EsignManagedSignerViewDto[];
  fields!: EsignFieldViewDto[];
}

export class EsignHistoryActorDto {
  kind!: 'signer' | 'employee' | 'system';
  name!: string;
  signerPublicId?: string;
}

export class EsignHistoryItemDto {
  type!: string;
  occurredAt!: string;
  actor!: EsignHistoryActorDto;
  reason!: string | null;
}
