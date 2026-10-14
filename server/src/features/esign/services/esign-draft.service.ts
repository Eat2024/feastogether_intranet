import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppException } from '#app/common/errors/app.exception';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
  type StoredPrivateFile,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { readPrivateFile } from '#app/infrastructure/file-storage/read-private-file';
import { DocumentRepository } from '../repositories/document.repository';
import { DocumentFieldRepository } from '../repositories/document-field.repository';
import { FileObjectRepository } from '../repositories/file-object.repository';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignAuditService } from './esign-audit.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { type PdfUpload, PdfValidationService } from './pdf-validation.service';

export interface CreateDraftInput extends PdfUpload {
  title: string;
  creatorUserId: number;
}

export interface UpdateDraftInput {
  title?: string;
  file?: PdfUpload;
}

@Injectable()
export class EsignDraftService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly documents: DocumentRepository,
    private readonly files: FileObjectRepository,
    private readonly fields: DocumentFieldRepository,
    private readonly access: EsignAccessPolicyService,
    private readonly validation: EsignDocumentValidationService,
    private readonly pdf: PdfValidationService,
    private readonly audit: EsignAuditService,
    @Inject(PRIVATE_FILE_STORAGE)
    private readonly storage: PrivateFileStorage,
  ) {}

  listCreatedBy(userId: number) {
    return this.documents.findCreatedByUser(userId, this.mysql.getManager());
  }

  async getForCreator(documentId: number, userId: number) {
    const document = await this.documents.findById(
      documentId,
      this.mysql.getManager(),
    );
    this.access.checkEsignCreator(document, userId);
    return document;
  }

  async create(input: CreateDraftInput) {
    const title = this.normalizeTitle(input.title);
    const uploadValidation = await this.pdf.validateUpload(input);
    const docNumber = randomUUID();
    const stored = await this.storage.store({
      directory: `documents/${docNumber}/source`,
      extension: 'pdf',
      mimeType: 'application/pdf',
      bytes: input.bytes,
    });

    try {
      const persisted = await this.validateStoredPdf(stored);
      if (persisted.sha256 !== uploadValidation.sha256) {
        throw this.integrityFailure();
      }
      return await this.mysql.transaction(async (manager) => {
        const document = await this.documents.save(
          this.documents.create(
            {
              docNumber,
              title,
              status: 'draft',
              createdByUserId: input.creatorUserId,
              watermarkEnabled: false,
              allowReject: false,
            },
            manager,
          ),
          manager,
        );
        await this.files.save(
          this.files.create(
            {
              documentId: document.id,
              filePurpose: 'source_pdf',
              objectKey: stored.objectKey,
              objectVersion: stored.objectVersion,
              originalFileName: basename(input.originalFileName),
              mimeType: persisted.mimeType,
              fileSize: persisted.fileSize,
              sha256: persisted.sha256,
              archiveStatus: 'active',
            },
            manager,
          ),
          manager,
        );
        await this.audit.append(
          {
            documentId: document.id,
            actorUserId: input.creatorUserId,
            eventType: 'document.created',
            occurredAt: new Date(),
            metadata: { status: 'draft' },
          },
          manager,
        );
        return document;
      });
    } catch (error) {
      await this.storage.delete(stored).catch(() => undefined);
      throw error;
    }
  }

  async update(documentId: number, userId: number, input: UpdateDraftInput) {
    if (input.title === undefined && input.file === undefined) {
      throw new AppException(
        AppErrorCode.INVALID_REQUEST,
        '至少需要提供一項草稿更新內容',
        HttpStatus.BAD_REQUEST,
      );
    }
    const title =
      input.title === undefined ? undefined : this.normalizeTitle(input.title);
    let replacement: StoredPrivateFile | undefined;
    let replacementMetadata:
      | Awaited<ReturnType<PdfValidationService['validatePersistedPdf']>>
      | undefined;

    if (input.file) {
      const mutable = await this.assertMutableDraft(documentId, userId);
      const uploadValidation = await this.pdf.validateUpload(input.file);
      replacement = await this.storage.store({
        directory: `documents/${mutable.docNumber}/source`,
        extension: 'pdf',
        mimeType: 'application/pdf',
        bytes: input.file.bytes,
      });
      try {
        replacementMetadata = await this.validateStoredPdf(replacement);
        if (replacementMetadata.sha256 !== uploadValidation.sha256) {
          throw this.integrityFailure();
        }
      } catch (error) {
        await this.storage.delete(replacement).catch(() => undefined);
        throw error;
      }
    }

    let previous: { objectKey: string; objectVersion?: string } | undefined;
    try {
      const document = await this.mysql.transaction(async (manager) => {
        const locked = await this.documents.findByIdForUpdate(
          documentId,
          manager,
        );
        this.access.checkEsignCreator(locked, userId);
        this.validation.checkStillDraft(locked);

        if (title !== undefined) locked.title = title;
        if (replacement && replacementMetadata && input.file) {
          // 新 PDF 的頁數與版面不同，舊欄位不可沿用。
          await this.fields.deleteDraftFields(documentId, manager);
          const oldFile = await this.files.findDocumentFile(
            documentId,
            'source_pdf',
            manager,
          );
          if (oldFile) {
            previous = {
              objectKey: oldFile.objectKey,
              objectVersion: oldFile.objectVersion,
            };
            await this.files.deleteById(oldFile.id, manager);
          }
          await this.files.save(
            this.files.create(
              {
                documentId,
                filePurpose: 'source_pdf',
                objectKey: replacement.objectKey,
                objectVersion: replacement.objectVersion,
                originalFileName: basename(input.file.originalFileName),
                mimeType: replacementMetadata.mimeType,
                fileSize: replacementMetadata.fileSize,
                sha256: replacementMetadata.sha256,
                archiveStatus: 'active',
              },
              manager,
            ),
            manager,
          );
        }
        const saved = await this.documents.save(locked, manager);
        await this.audit.append(
          {
            documentId,
            actorUserId: userId,
            eventType: 'document.draft_updated',
            occurredAt: new Date(),
            metadata: { status: 'draft' },
          },
          manager,
        );
        return saved;
      });
      if (previous) await this.storage.delete(previous).catch(() => undefined);
      return document;
    } catch (error) {
      if (replacement) {
        await this.storage.delete(replacement).catch(() => undefined);
      }
      throw error;
    }
  }

  async delete(documentId: number, userId: number): Promise<void> {
    await this.mysql.transaction(async (manager) => {
      const document = await this.documents.findByIdForUpdate(
        documentId,
        manager,
      );
      this.access.checkEsignCreator(document, userId);
      this.validation.checkStillDraft(document);
      const result = await this.documents.softDeleteDraft(
        documentId,
        new Date(),
        manager,
      );
      if (result.affected !== 1) this.validation.checkStillDraft(document);
      await this.audit.append(
        {
          documentId,
          actorUserId: userId,
          eventType: 'document.draft_deleted',
          occurredAt: new Date(),
          metadata: { status: 'draft' },
        },
        manager,
      );
    });
  }

  private async assertMutableDraft(documentId: number, userId: number) {
    const document = await this.documents.findById(
      documentId,
      this.mysql.getManager(),
    );
    this.access.checkEsignCreator(document, userId);
    this.validation.checkStillDraft(document);
    return document;
  }

  private normalizeTitle(title: string): string {
    const normalized = title.trim();
    if (normalized.length < 1 || normalized.length > 200) {
      throw new AppException(
        AppErrorCode.INVALID_REQUEST,
        '文件名稱必須為 1 至 200 字',
        HttpStatus.BAD_REQUEST,
      );
    }
    return normalized;
  }

  private async validateStoredPdf(stored: StoredPrivateFile) {
    const bytes = await readPrivateFile(this.storage, stored);
    return this.pdf.validatePersistedPdf(bytes);
  }

  private integrityFailure(): AppException {
    return new AppException(
      AppErrorCode.ESIGN_INTEGRITY_FAILED,
      '文件完整性驗證失敗',
      HttpStatus.CONFLICT,
    );
  }
}
