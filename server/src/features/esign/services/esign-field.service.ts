import { AppErrors } from '#app/common/errors/app-errors';
import type { EntityManager } from 'typeorm';
import { Inject, Injectable } from '@nestjs/common';
import { AppException } from '#app/common/errors/app.exception';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { readPrivateFile } from '#app/infrastructure/file-storage/read-private-file';
import type { FieldPlacementDto } from '../dto/field.dto';
import type { EsignDocument } from '../entities/esign-document.entity';
import { DocumentFieldRepository } from '../repositories/document-field.repository';
import { FileObjectRepository } from '../repositories/file-object.repository';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { PdfValidationService } from './pdf-validation.service';

@Injectable()
export class EsignFieldService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly fields: DocumentFieldRepository,
    private readonly files: FileObjectRepository,
    private readonly access: EsignAccessPolicyService,
    private readonly validation: EsignDocumentValidationService,
    private readonly pdf: PdfValidationService,
    @Inject(PRIVATE_FILE_STORAGE)
    private readonly storage: PrivateFileStorage,
  ) {}

  replace(
    documentId: number,
    creatorUserId: number,
    inputs: FieldPlacementDto[],
  ) {
    if (inputs.length > 200) {
      throw new AppException(...AppErrors.ESIGN_FIELD_LIMIT_EXCEEDED);
    }
    return this.mysql.transaction(async (manager) => {
      const document = await this.access.checkAndLockDraftDoc(
        documentId,
        creatorUserId,
        manager,
      );
      const { fields } = await this.buildFields(
        document,
        creatorUserId,
        inputs,
        manager,
      );
      return fields;
    });
  }

  /** 沿用呼叫端交易；呼叫端須先鎖定文件並驗證建立人與草稿狀態。 */
  async buildFields(
    document: EsignDocument,
    creatorUserId: number,
    inputs: FieldPlacementDto[],
    manager: EntityManager,
  ) {
    const documentId = document.id;

    const source = await this.files.findDocumentFile(
      documentId,
      'source_pdf',
      manager,
    );
    if (!source) throw new AppException(...AppErrors.ESIGN_DRAFT_PDF_MISSING);
    const bytes = await readPrivateFile(this.storage, source);
    const metadata = await this.pdf.validatePersistedPdf(bytes);
    this.validation.assertSourceIntegrity(document, source, metadata.sha256);

    const replacements = this.build(
      documentId,
      creatorUserId,
      inputs,
      metadata.pageCount,
      manager,
    );

    await this.fields.deleteDraftFields(documentId, manager);
    const fields = await this.fields.save(replacements, manager);
    // 沿用原本資料庫查詢的排序，確保簽署快照順序一致。
    fields.sort(
      (a, b) =>
        a.pageNumber - b.pageNumber ||
        a.sortOrder - b.sortOrder ||
        Number(a.id) - Number(b.id),
    );
    return { fields, source, sourceMetadata: metadata };
  }

  /** 依 PDF 頁數驗證欄位並建立待寫入的 entity；呼叫端負責交易與寫入。 */
  build(
    documentId: number,
    creatorUserId: number,
    inputs: FieldPlacementDto[],
    pageCount: number,
    manager: EntityManager,
  ) {
    if (inputs.length > 200)
      throw new AppException(...AppErrors.ESIGN_FIELD_LIMIT_EXCEEDED);
    return inputs.map((input) => {
      if (
        input.page > pageCount ||
        input.xPercent + input.widthPercent > 100 ||
        input.yPercent + input.heightPercent > 100
      ) {
        throw new AppException(...AppErrors.ESIGN_FIELD_OUT_OF_BOUNDS);
      }
      return this.fields.create(
        {
          documentId,
          fieldType: input.type,
          pageNumber: input.page,
          xPercent: input.xPercent.toFixed(3),
          yPercent: input.yPercent.toFixed(3),
          widthPercent: input.widthPercent.toFixed(3),
          heightPercent: input.heightPercent.toFixed(3),
          sortOrder: input.sortOrder,
          createdByUserId: creatorUserId,
          updatedByUserId: creatorUserId,
        },
        manager,
      );
    });
  }
}
