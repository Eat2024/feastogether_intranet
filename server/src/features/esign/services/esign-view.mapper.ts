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
  type EsignSignerType,
  EsignSignerViewDto,
  EsignSourceFileDto,
} from '../dto/esign-common.dto';
import { effectiveDocumentStatus } from './esign-document-validation.service';
import { EsignTokenService } from './esign-token.service';

export interface EsignSignerCounts {
  pendingCount: number;
  signedCount: number;
}

/** 將 persistence entity 明確裁切成公開 DTO，避免 credential 或 object key 外洩。 */
@Injectable()
export class EsignViewMapper {
  constructor(private readonly tokens: EsignTokenService) {}

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

  /** 列表項目：摘要再加上簽署期間與建立人 */
  documentListItem(
    document: EsignDocument,
    counts: EsignSignerCounts,
    creator: User | undefined,
    now = new Date(),
  ): EsignDocumentListItemDto {
    return {
      ...this.documentSummary(document, counts, now),
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

  /** verificationCode 來自本人的簽署紀錄；尚未簽署時沒有，驗證網址為 null */
  signer(
    signer: EsignSigner,
    invitationDelivery: EsignInvitationDelivery | null,
    verificationCode?: string,
  ): EsignSignerViewDto {
    return {
      publicId: signer.publicId,
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
      completion: {
        status: signer.completionStatus ?? null,
        readyAt: signer.completionReadyAt?.toISOString() ?? null,
      },
      invitationDelivery,
      verificationUrl: this.tokens.verificationUrl(verificationCode),
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
