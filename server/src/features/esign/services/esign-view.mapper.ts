import { Injectable } from '@nestjs/common';
import { EsignDocumentField } from '../entities/esign-document-field.entity';
import { EsignDocument } from '../entities/esign-document.entity';
import { EsignFileObject } from '../entities/esign-file-object.entity';
import { EsignSigner } from '../entities/esign-signer.entity';
import {
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

export interface EsignSignerCounts {
  pendingCount: number;
  signedCount: number;
}

/** 將 persistence entity 明確裁切成公開 DTO，避免 credential 或 object key 外洩。 */
@Injectable()
export class EsignViewMapper {
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

  sourceFile(file: EsignFileObject, pageCount: number): EsignSourceFileDto {
    return {
      fileName: file.originalFileName ?? 'document.pdf',
      size: Number(file.fileSize),
      pageCount,
      sha256: file.sha256,
    };
  }

  signer(
    signer: EsignSigner,
    invitationDelivery: EsignInvitationDelivery | null,
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
      invitationDelivery,
    };
  }

  field(field: EsignDocumentField, signerPublicId: string): EsignFieldViewDto {
    return {
      id: String(field.id),
      signerPublicId,
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
