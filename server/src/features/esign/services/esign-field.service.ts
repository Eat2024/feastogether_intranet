import type { EntityManager } from 'typeorm';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppException } from '#app/common/errors/app.exception';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { readPrivateFile } from '#app/infrastructure/file-storage/read-private-file';
import type { FieldInputDto } from '../dto/field.dto';
import { DocumentFieldRepository } from '../repositories/document-field.repository';
import { DocumentRepository } from '../repositories/document.repository';
import { FileObjectRepository } from '../repositories/file-object.repository';
import { SignerRepository } from '../repositories/signer.repository';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { PdfValidationService } from './pdf-validation.service';

@Injectable()
export class EsignFieldService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly documents: DocumentRepository,
    private readonly signers: SignerRepository,
    private readonly fields: DocumentFieldRepository,
    private readonly files: FileObjectRepository,
    private readonly access: EsignAccessPolicyService,
    private readonly validation: EsignDocumentValidationService,
    private readonly pdf: PdfValidationService,
    @Inject(PRIVATE_FILE_STORAGE)
    private readonly storage: PrivateFileStorage,
  ) {}

  replace(documentId: number, creatorUserId: number, inputs: FieldInputDto[]) {
    if (inputs.length > 200) {
      throw this.invalid('欄位數量不可超過 200 個');
    }
    return this.mysql.transaction((manager) =>
      this.replaceInTransaction(documentId, creatorUserId, inputs, manager),
    );
  }

  /** 沿用呼叫端交易；發起流程不得另開交易。 */
  async replaceInTransaction(
    documentId: number,
    creatorUserId: number,
    inputs: FieldInputDto[],
    manager: EntityManager,
  ) {
    if (inputs.length > 200) throw this.invalid('欄位數量不可超過 200 個');

    const document = await this.documents.findByIdForUpdate(
      documentId,
      manager,
    );
    this.access.checkEsignCreator(document, creatorUserId);
    this.validation.checkStillDraft(document);

    const source = await this.files.findDocumentFile(
      documentId,
      'source_pdf',
      manager,
    );
    if (!source) throw this.invalid('草稿缺少 PDF 文件');
    const bytes = await readPrivateFile(this.storage, source);
    const metadata = await this.pdf.validatePersistedPdf(bytes);
    this.validation.assertSourceIntegrity(document, source, metadata.sha256);

    const signers = await this.signers.findByDocument(documentId, manager);
    const signerByPublicId = new Map(
      signers.map((signer) => [signer.publicId, signer]),
    );
    const replacements = inputs.map((input) => {
      const signer = signerByPublicId.get(input.signerPublicId);
      if (!signer) throw this.invalid('欄位指定的簽署人不屬於本文件');
      if (
        input.page > metadata.pageCount ||
        input.xPercent + input.widthPercent > 100 ||
        input.yPercent + input.heightPercent > 100
      ) {
        throw this.invalid('欄位頁碼或位置超出 PDF 範圍');
      }
      return this.fields.create(
        {
          documentId,
          signerId: signer.id,
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

    await this.fields.deleteDraftFields(documentId, manager);
    return this.fields.save(replacements, manager);
  }

  private invalid(message: string): AppException {
    return new AppException(
      AppErrorCode.INVALID_REQUEST,
      message,
      HttpStatus.BAD_REQUEST,
    );
  }
}
