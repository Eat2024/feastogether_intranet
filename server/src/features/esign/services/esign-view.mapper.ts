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
import { EsignTokenService } from './esign-token.service';

export interface EsignSignerCounts {
  pendingCount: number;
  signedCount: number;
}

/** 將 persistence entity 明確裁切成公開 DTO，避免 credential 或 object key 外洩。 */
@Injectable()
export class EsignViewMapper {
  constructor(private readonly tokens: EsignTokenService) {}

  documentSummary(
    document: EsignDocument,
    counts: EsignSignerCounts,
  ): EsignDocumentSummaryDto {
    return {
      id: String(document.id),
      docNumber: document.docNumber,
      title: document.title,
      status: document.status as EsignDocumentStatus,
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
  ): EsignDocumentListItemDto {
    return {
      ...this.documentSummary(document, counts),
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
