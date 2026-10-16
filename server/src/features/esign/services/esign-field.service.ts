import type { EntityManager } from 'typeorm';
import { Inject, Injectable } from '@nestjs/common';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { readPrivateFile } from '#app/infrastructure/file-storage/read-private-file';
import type { FieldInputDto } from '../dto/field.dto';
import type { EsignDocument } from '../entities/esign-document.entity';
import type { EsignSigner } from '../entities/esign-signer.entity';
import { invalidRequest } from '../helpers/esign-errors';
import { DocumentFieldRepository } from '../repositories/document-field.repository';
import { FileObjectRepository } from '../repositories/file-object.repository';
import { SignerRepository } from '../repositories/signer.repository';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { PdfValidationService } from './pdf-validation.service';

@Injectable()
export class EsignFieldService {
  constructor(
    private readonly mysql: MysqlService,
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
    if (inputs.length > 200) throw invalidRequest('欄位數量不可超過 200 個');
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
    inputs: FieldInputDto[],
    manager: EntityManager,
  ) {
    const documentId = document.id;

    const source = await this.files.findDocumentFile(
      documentId,
      'source_pdf',
      manager,
    );
    if (!source) throw invalidRequest('草稿缺少 PDF 文件');
    const bytes = await readPrivateFile(this.storage, source);
    const metadata = await this.pdf.validatePersistedPdf(bytes);
    this.validation.assertSourceIntegrity(document, source, metadata.sha256);

    const signers = await this.signers.findByDocument(documentId, manager);
    const replacements = this.build(
      documentId,
      creatorUserId,
      inputs,
      metadata.pageCount,
      signers,
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
    inputs: FieldInputDto[],
    pageCount: number,
    signers: EsignSigner[],
    manager: EntityManager,
  ) {
    if (inputs.length > 200) throw invalidRequest('欄位數量不可超過 200 個');
    const signerByPublicId = new Map(
      signers.map((signer) => [signer.publicId, signer]),
    );
    return inputs.map((input) => {
      // 未帶簽署人的欄位存成未指派，由發起流程確認每個欄位都已指派。
      const signer = input.signerPublicId
        ? signerByPublicId.get(input.signerPublicId)
        : undefined;
      if (input.signerPublicId && !signer) {
        throw invalidRequest('欄位指定的簽署人不屬於本文件');
      }
      if (
        input.page > pageCount ||
        input.xPercent + input.widthPercent > 100 ||
        input.yPercent + input.heightPercent > 100
      ) {
        throw invalidRequest('欄位頁碼或位置超出 PDF 範圍');
      }
      return this.fields.create(
        {
          documentId,
          signerId: signer?.id,
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
