import type { Actor } from '#app/features/auth/auth.types';
import { AuthorizationService } from '#app/features/authorization/services/authorization.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { actorAudit, markDocumentUpdated } from '../helpers/management-actor';
import { AppErrors } from '#app/common/errors/app-errors';
import type { EntityManager } from 'typeorm';
import type { EsignDocument } from '../entities/esign-document.entity';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { AppException } from '#app/common/errors/app.exception';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
  type PrivateFileReference,
  type StoredPrivateFile,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { readPrivateFile } from '#app/infrastructure/file-storage/read-private-file';
import type { FieldPlacementDto } from '../dto/field.dto';
import { DocumentRepository } from '../repositories/document.repository';
import { DocumentFieldRepository } from '../repositories/document-field.repository';
import { FileObjectRepository } from '../repositories/file-object.repository';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignFieldService } from './esign-field.service';
import {
  type PdfUpload,
  type ValidatedPdf,
  PdfValidationService,
} from './pdf-validation.service';

export interface CreateDraftInput extends PdfUpload {
  title: string;
  actor: Actor;
  departmentCode?: string;
  fields?: FieldPlacementDto[];
}

export interface UpdateDraftInput {
  title?: string;
  file?: PdfUpload;
  /** 有帶時整批取代草稿欄位；換 PDF 而未帶時沿用原行為清空欄位 */
  fields?: FieldPlacementDto[];
}

interface PreparedNewPdf {
  stored: StoredPrivateFile;
  metadata: ValidatedPdf;
  originalFileName: string;
}

@Injectable()
export class EsignDraftService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly documents: DocumentRepository,
    private readonly files: FileObjectRepository,
    private readonly fields: DocumentFieldRepository,
    private readonly access: EsignAccessPolicyService,
    private readonly pdf: PdfValidationService,
    @Inject(PRIVATE_FILE_STORAGE)
    private readonly storage: PrivateFileStorage,
    private readonly fieldService: EsignFieldService,
    private readonly authorization: AuthorizationService,
    private readonly validation: EsignDocumentValidationService,
  ) {}

  listCreatedBy(userId: number) {
    return this.documents.findCreatedByUser(userId, this.mysql.getManager());
  }

  async getForCreator(documentId: number, actor: Actor) {
    const document = await this.documents.findById(
      documentId,
      this.mysql.getManager(),
    );
    await this.access.manageableDocument(
      document,
      actor,
      this.mysql.getManager(),
    );
    return document;
  }

  async create(input: CreateDraftInput) {
    await this.authorization.requirePermissions(input.actor, [
      'esign.document.create',
    ]);
    if (input.actor.kind === 'employee' && input.departmentCode !== undefined)
      throw new AppException(...AppErrors.REQUEST_FORMAT_INVALID);
    const department =
      input.actor.kind === 'super_user'
        ? await this.validation.requireCreationDepartment(input.departmentCode)
        : undefined;
    const title = this.normalizeTitle(input.title);
    const docNumber = randomUUID();
    const newPdf = await this.storeValidatedPdf(docNumber, input);

    try {
      return await this.mysql.transaction(async (manager) => {
        const document = await this.createDraftDocument(
          docNumber,
          title,
          input.actor,
          manager,
          department,
        );
        await this.saveSourcePdf(document.id, newPdf, manager);
        if (input.fields?.length) {
          await this.createDraftFields(
            document.id,
            input.actor,
            input.fields,
            newPdf.metadata.pageCount,
            manager,
          );
        }
        return document;
      });
    } catch (error) {
      await this.storage.delete(newPdf.stored).catch(() => undefined);
      throw error;
    }
  }

  private async createDraftDocument(
    docNumber: string,
    title: string,
    actor: Actor,
    manager: EntityManager,
    department?: { departmentCode: string; departmentName: string },
  ): Promise<EsignDocument> {
    const creator =
      actor.kind === 'employee'
        ? await this.access.requireDepartment(actor.userId, manager, true)
        : department;
    await this.authorization.requirePermissions(
      actor,
      ['esign.document.create'],
      manager,
    );
    if (!creator) throw new AppException(...AppErrors.REQUEST_FORMAT_INVALID);
    const draft = this.documents.create(
      {
        docNumber,
        title,
        status: 'draft',
        ...actorAudit(actor),
        createdByDepartmentCode: creator.departmentCode,
        createdByDepartmentName: creator.departmentName ?? null,
        watermarkEnabled: false,
        allowReject: false,
      },
      manager,
    );
    return await this.documents.save(draft, manager);
  }

  private async createDraftFields(
    documentId: number,
    actor: Actor,
    inputs: FieldPlacementDto[],
    pageCount: number,
    manager: EntityManager,
  ): Promise<void> {
    // 上傳時保存共用欄位，不需要先設定簽署人。
    const fields = this.fieldService.build(
      documentId,
      actor,
      inputs,
      pageCount,
      manager,
    );
    await this.fields.save(fields, manager);
  }

  async update(documentId: number, actor: Actor, input: UpdateDraftInput) {
    const title = this.validateUpdateInput(input);
    await this.access.assertManagerNotInitiating(
      documentId,
      actor,
      this.mysql.getManager(),
    );
    const newPdf = input.file
      ? await this.prepareNewPdf(documentId, actor, input.file)
      : undefined;

    let previous: PrivateFileReference | undefined;
    try {
      const document = await this.mysql.transaction(async (manager) => {
        // 上傳期間文件可能已被發起，寫入前必須在鎖內重新驗證。
        const lockedFile = await this.access.lockManagedDraft(
          documentId,
          actor,
          manager,
        );
        if (title !== undefined) lockedFile.title = title;
        if (newPdf) {
          previous = await this.replaceSourcePdf(documentId, newPdf, manager);
        }
        if (input.fields) {
          await this.replaceUpdateFields(
            lockedFile,
            actor,
            input.fields,
            newPdf?.metadata,
            manager,
          );
        }
        markDocumentUpdated(lockedFile, actor);
        const saved = await this.documents.save(lockedFile, manager);
        return saved;
      });
      // 舊檔只能在交易提交成功後刪除。
      if (previous) await this.storage.delete(previous).catch(() => undefined);
      return document;
    } catch (error) {
      if (newPdf) {
        await this.storage.delete(newPdf.stored).catch(() => undefined);
      }
      throw error;
    }
  }

  private validateUpdateInput(input: UpdateDraftInput): string | undefined {
    if (
      input.title === undefined &&
      input.file === undefined &&
      input.fields === undefined
    ) {
      throw new AppException(...AppErrors.ESIGN_DRAFT_UPDATE_REQUIRED);
    }
    return input.title === undefined
      ? undefined
      : this.normalizeTitle(input.title);
  }

  private async prepareNewPdf(
    documentId: number,
    actor: Actor,
    file: PdfUpload,
  ): Promise<PreparedNewPdf> {
    // 先確認權限，避免未授權請求寫入檔案；檔案 I/O 不佔用交易鎖。
    const document = await this.checkDraftDocs(documentId, actor);
    return this.storeValidatedPdf(document.docNumber, file);
  }

  private async storeValidatedPdf(
    docNumber: string,
    file: PdfUpload,
  ): Promise<PreparedNewPdf> {
    const uploadValidation = await this.pdf.validateUpload(file);
    const stored = await this.storage.store({
      directory: `documents/${docNumber}/source`,
      extension: 'pdf',
      mimeType: 'application/pdf',
      bytes: file.bytes,
    });
    try {
      const metadata = await this.validateStoredPdf(stored);
      if (metadata.sha256 !== uploadValidation.sha256) {
        throw this.integrityFailure();
      }
      return {
        stored,
        metadata,
        originalFileName: basename(file.originalFileName),
      };
    } catch (error) {
      await this.storage.delete(stored).catch(() => undefined);
      throw error;
    }
  }

  private async replaceSourcePdf(
    documentId: number,
    newPdf: PreparedNewPdf,
    manager: EntityManager,
  ): Promise<PrivateFileReference | undefined> {
    // 新 PDF 的頁數與版面不同，舊欄位不可沿用。
    await this.fields.deleteDraftFields(documentId, manager);
    const oldFile = await this.files.findDocumentFile(
      documentId,
      'source_pdf',
      manager,
    );
    if (oldFile) await this.files.deleteById(oldFile.id, manager);
    await this.saveSourcePdf(documentId, newPdf, manager);
    return oldFile
      ? { objectKey: oldFile.objectKey, objectVersion: oldFile.objectVersion }
      : undefined;
  }

  private async saveSourcePdf(
    documentId: number,
    newPdf: PreparedNewPdf,
    manager: EntityManager,
  ): Promise<void> {
    const { stored, metadata, originalFileName } = newPdf;
    const file = this.files.create(
      {
        documentId,
        filePurpose: 'source_pdf',
        objectKey: stored.objectKey,
        objectVersion: stored.objectVersion,
        originalFileName,
        mimeType: metadata.mimeType,
        fileSize: metadata.fileSize,
        sha256: metadata.sha256,
        archiveStatus: 'active',
      },
      manager,
    );
    await this.files.save(file, manager);
  }

  private async replaceUpdateFields(
    document: EsignDocument,
    actor: Actor,
    inputs: FieldPlacementDto[],
    newPdfMetadata: ValidatedPdf | undefined,
    manager: EntityManager,
  ): Promise<void> {
    if (!newPdfMetadata) {
      await this.fieldService.buildFields(document, actor, inputs, manager);
      return;
    }
    // 舊欄位已隨舊 PDF 清除，直接沿用新 PDF 的驗證結果。
    const fields = this.fieldService.build(
      document.id,
      actor,
      inputs,
      newPdfMetadata.pageCount,
      manager,
    );
    await this.fields.save(fields, manager);
  }

  async delete(documentId: number, actor: Actor): Promise<void> {
    await this.access.assertManagerNotInitiating(
      documentId,
      actor,
      this.mysql.getManager(),
    );
    await this.mysql.transaction(async (manager) => {
      const document = await this.access.lockManagedDraft(
        documentId,
        actor,
        manager,
      );
      document.deletedAt = new Date();
      markDocumentUpdated(document, actor);
      await this.documents.save(document, manager);
    });
  }

  private async checkDraftDocs(documentId: number, actor: Actor) {
    const document = await this.documents.findById(
      documentId,
      this.mysql.getManager(),
    );
    await this.access.manageableDocument(
      document,
      actor,
      this.mysql.getManager(),
    );
    if (!document)
      throw new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
    this.validation.checkStillDraft(document);
    return document;
  }

  private normalizeTitle(title: string): string {
    const normalized = title.trim();
    if (normalized.length < 1 || normalized.length > 200) {
      throw new AppException(...AppErrors.ESIGN_DOCUMENT_NAME_INVALID);
    }
    return normalized;
  }

  private async validateStoredPdf(stored: StoredPrivateFile) {
    const bytes = await readPrivateFile(this.storage, stored);
    return this.pdf.validatePersistedPdf(bytes);
  }

  private integrityFailure(): AppException {
    return new AppException(...AppErrors.ESIGN_INTEGRITY_FAILED);
  }
}
