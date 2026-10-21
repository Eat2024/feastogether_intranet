import { AppErrors } from '#app/common/errors/app-errors';
import { Inject, Injectable } from '@nestjs/common';
import { AppException } from '#app/common/errors/app.exception';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { readPrivateFile } from '#app/infrastructure/file-storage/read-private-file';
import type { EsignDocument } from '../entities/esign-document.entity';
import type { EsignSigner } from '../entities/esign-signer.entity';
import { DocumentRepository } from '../repositories/document.repository';
import { FileObjectRepository } from '../repositories/file-object.repository';
import { SignatureRecordRepository } from '../repositories/signature-record.repository';
import { SignerRepository } from '../repositories/signer.repository';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { canonicalSha256 } from './esign-audit.service';
import { PdfValidationService } from './pdf-validation.service';

@Injectable()
export class EsignCompletionAccessService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly documents: DocumentRepository,
    private readonly signers: SignerRepository,
    private readonly files: FileObjectRepository,
    private readonly access: EsignAccessPolicyService,
    private readonly pdf: PdfValidationService,
    @Inject(PRIVATE_FILE_STORAGE) private readonly storage: PrivateFileStorage,
    private readonly records: SignatureRecordRepository,
  ) {}

  async creatorFile(
    documentId: number,
    signerPublicId: string,
    userId: number,
  ) {
    const manager = this.mysql.getManager();
    const document = await this.documents.findById(documentId, manager);
    this.access.checkEsignCreator(document, userId);
    const signer = await this.signers.findByPublicId(signerPublicId, manager);
    if (!signer || signer.documentId !== documentId) throw this.notFound();
    return this.personalCopy(document, signer);
  }

  async signerFile(
    signerPublicId: string,
    userId: number,
  ): Promise<
    Awaited<ReturnType<EsignCompletionAccessService['personalCopy']>>
  > {
    const manager = this.mysql.getManager();
    const signer = await this.signers.findByPublicId(signerPublicId, manager);
    const document = signer
      ? await this.documents.findById(signer.documentId, manager)
      : null;
    if (!signer || !document) throw this.notFound();
    this.access.assertInternalSigner(document, signer, userId);
    throw new AppException(...AppErrors.ESIGN_EMAIL_OTP_REQUIRED);
  }

  /**
   * 讀取並驗證簽署人的本人副本；未產生時回傳 null。
   * 不做授權檢查，呼叫端必須先確認呼叫者可存取此簽署人。
   */
  async personalCopy(document: EsignDocument, signer: EsignSigner) {
    if (
      !['active', 'expired', 'finalizing', 'completed', 'stopped'].includes(
        document.status,
      ) ||
      signer.status !== 'signed' ||
      signer.completionStatus !== 'ready'
    )
      return null;
    const manager = this.mysql.getManager();
    const record = await this.records.findBySignerId(signer.id, manager);
    if (
      !record ||
      record.signerId !== signer.id ||
      record.signingPayloadSha256 !== document.signingPayloadSha256 ||
      canonicalSha256(document.signingPayloadJson) !==
        document.signingPayloadSha256 ||
      record.signedAtUtc.getTime() !== signer.signedAt?.getTime()
    )
      throw this.integrity();
    const file = await this.files.findCompletedFile(record.id, manager);
    if (
      !file ||
      file.signatureRecordId !== record.id ||
      file.documentId != null ||
      file.documentFieldId != null ||
      file.verificationRecordId != null ||
      file.exportJobId != null ||
      file.filePurpose !== 'completed_pdf' ||
      file.mimeType !== 'application/pdf' ||
      file.archiveStatus !== 'active'
    )
      throw this.integrity();
    const bytes = await readPrivateFile(this.storage, file);
    const metadata = await this.pdf.validatePersistedPdf(bytes);
    if (
      metadata.sha256 !== file.sha256 ||
      bytes.byteLength !== Number(file.fileSize)
    )
      throw this.integrity();
    return {
      bytes,
      fileName: this.completedPdfFileName(document, signer),
    };
  }

  /** 個人副本檔名由文件編號、文件名稱與簽署人姓名組成。 */
  private completedPdfFileName(
    document: EsignDocument,
    signer: EsignSigner,
  ): string {
    const sanitize = (value: string) =>
      Array.from(value, (character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127 || '<>:"/\\|?*'.includes(character)
          ? '_'
          : character;
      })
        .join('')
        .trim();
    return `${sanitize(document.docNumber)}_${sanitize(document.title)}_${sanitize(signer.nameSnapshot)}.pdf`;
  }

  private notFound() {
    return new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
  }
  private integrity() {
    return new AppException(...AppErrors.ESIGN_INTEGRITY_FAILED);
  }
}
