import type { DocumentListProjection } from '../repositories/document.repository';
import type { EsignAuditEvent } from '../entities/esign-audit-event.entity';
import type { EsignHistoryActorDto } from '../dto/esign-common.dto';
import { Injectable } from '@nestjs/common';
import type { User } from '#app/features/users/entities/user.entity';
import { EsignDocumentField } from '../entities/esign-document-field.entity';
import { EsignDocument } from '../entities/esign-document.entity';
import { EsignFileObject } from '../entities/esign-file-object.entity';
import { EsignSigner } from '../entities/esign-signer.entity';
import {
  EsignDocumentCreatorDto,
  EsignDocumentListItemDto,
  type EsignDocumentStatus,
  EsignDocumentSummaryDto,
  type EsignFieldType,
  EsignFieldViewDto,
  type EsignInvitationDelivery,
  type EsignSignerStatus,
  type EsignSignerResult,
  type EsignSignerType,
  EsignSignerViewDto,
  EsignSourceFileDto,
} from '../dto/esign-common.dto';
import type { ExcelExportDocumentDto } from '../dto/export-history.dto';
import { effectiveDocumentStatus } from './esign-document-validation.service';
import { EsignTokenService } from './esign-token.service';

/** 歷程顯示投影；原始事件代碼仍保留供稽核與畫面分組。 */
const HISTORY_LABELS = new Map<string, string>([
  ['consent.accepted', '簽署人同意電子簽名條款'],
  ['document.completed', '所有簽署人皆已完成簽署或拒簽'],
  ['document.created', '建立草稿'],
  ['document.draft_deleted', '刪除草稿'],
  ['document.draft_updated', '更新草稿'],
  ['document.expired', '簽署期限已到，文件已到期'],
  ['document.initiated', '發起簽署'],
  ['document.opened', '簽署人開啟文件'],
  ['document.reopened', '建立人設定補簽，重新開放未簽署者簽署'],
  ['document.stopped_by_creator', '建立人停止簽署'],
  ['document.stopped_by_deadline', '簽署期限已到，系統自動停止'],
  ['external_invitation.delivered', '外部簽署人邀請信已寄送'],
  ['external_invitation.opened', '外部簽署人開啟邀請連結'],
  ['external_otp.failed', '外部簽署人輸入的驗證碼錯誤'],
  ['external_otp.locked', '外部簽署人驗證碼錯誤次數已滿，驗證碼失效'],
  ['external_otp.sent', '寄送驗證碼給外部簽署人'],
  ['external_otp.verified', '外部簽署人通過驗證碼'],
  ['external_reminder.delivered', '外部簽署人催簽信已寄送'],
  ['internal_invitation.delivered', '已寄出內部簽署邀請通知'],
  ['internal_notification.protocol_error', '內部通知寄送結果異常'],
  ['internal_reminder.delivered', '已寄出內部催簽通知'],
  ['signature.completed', '簽署人完成簽署'],
  ['signature.submitted', '簽署人送出簽名'],
  ['signer.assigned', '指派簽署人'],
  ['signer.copy_completed', '個人簽署副本產生完成'],
  ['signer.copy_failed', '個人簽署副本產生失敗'],
  ['signer.rejected', '簽署人拒絕簽署'],
]);

export interface EsignSignerCounts {
  pendingCount: number;
  signedCount: number;
}

/** 將 persistence entity 明確裁切成公開 DTO，避免 credential 或 object key 外洩。 */
@Injectable()
export class EsignViewMapper {
  constructor(private readonly tokens: EsignTokenService) {}

  historyLabel(type: string): string {
    return HISTORY_LABELS.get(type) ?? '其他簽署歷程事件';
  }

  /** 事件種類決定動作者，signerId 也可能只是系統工作的對象。 */
  historyActor(
    event: EsignAuditEvent,
    signer?: EsignSigner,
    employee?: User,
  ): EsignHistoryActorDto {
    const signerActions = new Set([
      'document.opened',
      'consent.accepted',
      'signature.submitted',
      'signature.completed',
      'signer.rejected',
      'external_invitation.opened',
      'external_otp.verified',
      'external_otp.failed',
    ]);
    if (signerActions.has(event.eventType) && signer) {
      return {
        kind: 'signer',
        name: signer.nameSnapshot,
        signerPublicId: signer.publicId,
      };
    }
    const employeeActions = new Set([
      'document.created',
      'document.draft_updated',
      'document.draft_deleted',
      'document.initiated',
      'document.stopped_by_creator',
      'document.reopened',
      'signer.assigned',
    ]);
    if (employeeActions.has(event.eventType) && event.actorUserId) {
      return { kind: 'employee', name: employee?.name ?? '員工' };
    }
    return { kind: 'system', name: '系統' };
  }

  documentSummary(
    document: EsignDocument,
    counts: EsignSignerCounts,
    now = new Date(),
  ): EsignDocumentSummaryDto {
    return {
      ...this.signingEnd(document),
      id: String(document.id),
      docNumber: document.docNumber,
      title: document.title,
      status: effectiveDocumentStatus(
        document,
        counts.pendingCount,
        now,
      ) as EsignDocumentStatus,
      createdAt: document.createdAt.toISOString(),
      initiatedAt: document.initiatedAt?.toISOString() ?? null,
      completedAt: document.completedAt?.toISOString() ?? null,
      stoppedAt: document.stoppedAt?.toISOString() ?? null,
      pendingCount: counts.pendingCount,
      signedCount: counts.signedCount,
    };
  }

  /** 截止時間；重新開放後與發起時固定的 originalSignEndAt 不同 */
  private signingEnd(document: EsignDocument) {
    const period = document.signingPayloadJson?.period;
    const originalSignEndAt =
      document.status !== 'draft' &&
      period &&
      typeof period === 'object' &&
      'endAt' in period &&
      typeof period.endAt === 'string'
        ? period.endAt
        : null;
    const signEndAt = document.signEndAt?.toISOString() ?? null;
    return {
      signEndAt,
      originalSignEndAt,
      isReopened:
        originalSignEndAt !== null &&
        signEndAt !== null &&
        signEndAt !== originalSignEndAt,
    };
  }

  /** 列表項目：摘要再加上簽署期間與建立人 */
  documentListItem(
    document: DocumentListProjection,
    counts: EsignSignerCounts,
    creator: User | undefined,
    now = new Date(),
    viewerUserId?: number,
  ): EsignDocumentListItemDto {
    return {
      ...this.documentSummary(document, counts, now),
      ...(document.status === 'draft' && document.isInitiating
        ? { status: 'initiating' as const }
        : {}),
      initiation:
        document.status === 'draft' && document.isInitiating
          ? (document.initiation ?? null)
          : null,
      isCreator: document.createdByUserId === viewerUserId,
      signStartAt: document.signStartAt?.toISOString() ?? null,
      signEndAt: document.signEndAt?.toISOString() ?? null,
      createdBy: this.creator(creator),
    };
  }

  /** 建立人只給姓名與員編；帳號不存在時為 null */
  creator(user: User | null | undefined): EsignDocumentCreatorDto | null {
    return user ? { name: user.name, employeeNo: user.empid } : null;
  }

  sourceFile(file: EsignFileObject, pageCount: number): EsignSourceFileDto {
    return {
      fileName: file.originalFileName ?? 'document.pdf',
      size: Number(file.fileSize),
      pageCount,
      sha256: file.sha256,
    };
  }

  readonlySigner(signer: EsignSigner) {
    return {
      publicId: signer.publicId,
      name: signer.nameSnapshot,
      status: signer.status as EsignSignerStatus,
      signedAt: signer.signedAt?.toISOString() ?? null,
      rejectedAt: signer.rejectedAt?.toISOString() ?? null,
    };
  }

  /** verificationCode 來自本人的簽署紀錄；尚未簽署時沒有，驗證網址為 null */
  signer(
    signer: EsignSigner,
    invitationDelivery: EsignInvitationDelivery | null,
    verificationCode?: string,
  ): EsignSignerViewDto {
    return {
      publicId: signer.publicId,
      ...this.signerResult(signer),
      completion: {
        status: signer.completionStatus ?? null,
        readyAt: signer.completionReadyAt?.toISOString() ?? null,
      },
      invitationDelivery,
      verificationUrl: this.tokens.verificationUrl(verificationCode),
    };
  }

  /** Excel 重新下載資料：文件目前的期間、建立人與簽署結果。 */
  excelExportDocument(
    document: EsignDocument,
    creator: User | null,
    signers: EsignSigner[],
  ): ExcelExportDocumentDto {
    return {
      id: String(document.id),
      title: document.title,
      docNumber: document.docNumber,
      signStartAt: document.signStartAt?.toISOString() ?? null,
      ...this.signingEnd(document),
      createdBy: this.creator(creator),
      signers: signers.map((signer) => this.signerResult(signer)),
    };
  }

  /** 簽署人身分快照與簽署結果；Excel 只需要這些欄位。 */
  private signerResult(signer: EsignSigner): EsignSignerResult {
    return {
      type: signer.signerType as EsignSignerType,
      name: signer.nameSnapshot,
      employeeNo: signer.empidSnapshot ?? null,
      department: signer.departmentSnapshot ?? null,
      title: signer.titleSnapshot ?? null,
      email: signer.email ?? null,
      status: signer.status as EsignSignerStatus,
      signedAt: signer.signedAt?.toISOString() ?? null,
      rejectedAt: signer.rejectedAt?.toISOString() ?? null,
      rejectReason: signer.rejectReason ?? null,
    };
  }

  field(field: EsignDocumentField): EsignFieldViewDto {
    return {
      id: String(field.id),
      type: field.fieldType as EsignFieldType,
      page: field.pageNumber,
      xPercent: Number(field.xPercent),
      yPercent: Number(field.yPercent),
      widthPercent: Number(field.widthPercent),
      heightPercent: Number(field.heightPercent),
      sortOrder: field.sortOrder,
    };
  }
}
