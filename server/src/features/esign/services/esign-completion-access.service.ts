import { Inject, Injectable } from '@nestjs/common';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { readPrivateFile } from '#app/infrastructure/file-storage/read-private-file';
import { AuditEventRepository } from '../repositories/audit-event.repository';
import { DocumentRepository } from '../repositories/document.repository';
import { FileObjectRepository } from '../repositories/file-object.repository';
import { SignatureRecordRepository } from '../repositories/signature-record.repository';
import { SignerRepository } from '../repositories/signer.repository';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { EsignTokenService } from './esign-token.service';
import { PdfValidationService } from './pdf-validation.service';

@Injectable()
export class EsignCompletionAccessService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly documents: DocumentRepository,
    private readonly signers: SignerRepository,
    private readonly files: FileObjectRepository,
    private readonly audits: AuditEventRepository,
    private readonly tokens: EsignTokenService,
    private readonly access: EsignAccessPolicyService,
    private readonly validation: EsignDocumentValidationService,
    private readonly pdf: PdfValidationService,
    @Inject(PRIVATE_FILE_STORAGE)
    private readonly storage: PrivateFileStorage,
    private readonly records: SignatureRecordRepository,
  ) {}

  async internalFile(documentId: number, userId: number) {
    const manager = this.mysql.getManager();
    const document = await this.documents.findById(documentId, manager);
    const signer = document
      ? (await this.signers.findByDocument(documentId, manager)).find(
          (candidate) => candidate.userId === userId,
        ) ?? null
      : null;
    this.access.assertCreatorOrSignedInternalSigner(document, signer, userId);
    if (!document || document.status !== 'completed') return null;
    return this.completedFile(document.id);
  }

  async receiptStatus(signerPublicId: string, token: string) {
    const { signer, document } = await this.receiptContext(
      signerPublicId,
      token,
    );
    // 完成回執只在簽署成功後核發，持有者必有簽署紀錄
    const record = await this.records.findBySignerId(
      signer.id,
      this.mysql.getManager(),
    );
    return {
      title: document.title,
      status: document.status,
      completedAt: document.completedAt?.toISOString() ?? null,
      stoppedAt: document.stoppedAt?.toISOString() ?? null,
      verificationUrl: this.tokens.verificationUrl(record?.verificationCode),
    };
  }

  async receiptFile(signerPublicId: string, token: string) {
    const { document } = await this.receiptContext(signerPublicId, token);
    if (document.status !== 'completed') return null;
    return this.completedFile(document.id);
  }

  async receiptHistory(signerPublicId: string, token: string) {
    const { signer, document } = await this.receiptContext(
      signerPublicId,
      token,
    );
    const events = await this.audits.findDocumentEvents(
      document.id,
      this.mysql.getManager(),
    );
    const allowed = new Set([
      'external_invitation.opened',
      'document.opened',
      'signature.completed',
      'document.completed',
      'document.stopped_by_creator',
      'document.stopped_by_deadline',
    ]);
    return events
      .filter(
        (event) =>
          allowed.has(event.eventType) &&
          (event.signerId === undefined || event.signerId === signer.id),
      )
      .map((event) => ({
        type: event.eventType,
        occurredAt: event.occurredAt.toISOString(),
        actor: event.signerId === signer.id ? '本人' : '系統',
        reason:
          typeof event.metadataJson?.reason === 'string'
            ? event.metadataJson.reason
            : null,
      }));
  }

  private async receiptContext(signerPublicId: string, token: string) {
    const manager = this.mysql.getManager();
    const digest = this.tokens.digest(token);
    const signer = await this.signers.findByReceiptDigest(digest, manager);
    const document = signer
      ? await this.documents.findById(signer.documentId, manager)
      : null;
    if (!signer || signer.publicId !== signerPublicId || !document) {
      this.access.assertReceipt(document, signer, digest, new Date());
      throw new Error('unreachable');
    }
    this.access.assertReceipt(document, signer, digest, new Date());
    return { signer, document };
  }

  private async completedFile(documentId: number) {
    const manager = this.mysql.getManager();
    const file = await this.files.findDocumentFile(
      documentId,
      'completed_pdf',
      manager,
    );
    if (!file) return null;
    const bytes = await readPrivateFile(this.storage, file);
    const metadata = await this.pdf.validatePersistedPdf(bytes);
    const document = await this.documents.findById(documentId, manager);
    if (!document) return null;
    this.validation.assertFileIntegrity(
      document,
      file,
      'completed_pdf',
      metadata.sha256,
    );
    return { bytes, fileName: 'completed.pdf' };
  }
}
