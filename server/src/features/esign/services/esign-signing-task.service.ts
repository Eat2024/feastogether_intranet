import { Inject, Injectable } from '@nestjs/common';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { readPrivateFile } from '#app/infrastructure/file-storage/read-private-file';
import { DocumentFieldRepository } from '../repositories/document-field.repository';
import { DocumentRepository } from '../repositories/document.repository';
import { FileObjectRepository } from '../repositories/file-object.repository';
import { SignerRepository } from '../repositories/signer.repository';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignAuditService } from './esign-audit.service';
import { EsignConsentService } from './esign-consent.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { EsignViewMapper } from './esign-view.mapper';
import { PdfValidationService } from './pdf-validation.service';

@Injectable()
export class EsignSigningTaskService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly documents: DocumentRepository,
    private readonly signers: SignerRepository,
    private readonly fields: DocumentFieldRepository,
    private readonly files: FileObjectRepository,
    private readonly access: EsignAccessPolicyService,
    private readonly validation: EsignDocumentValidationService,
    private readonly consent: EsignConsentService,
    private readonly mapper: EsignViewMapper,
    private readonly pdf: PdfValidationService,
    private readonly audit: EsignAuditService,
    @Inject(PRIVATE_FILE_STORAGE)
    private readonly storage: PrivateFileStorage,
  ) {}

  async list(userId: number, status?: 'pending' | 'signed') {
    const manager = this.mysql.getManager();
    const signers = await this.signers.findAssignedToUser(userId, manager);
    const filtered = status
      ? signers.filter((signer) => signer.status === status)
      : signers;
    const tasks: Array<Awaited<ReturnType<EsignSigningTaskService['toTask']>>> =
      [];
    for (const signer of filtered) {
      const document = await this.documents.findById(
        signer.documentId,
        manager,
      );
      if (!document || document.status === 'draft') continue;
      tasks.push(await this.toTask(document, signer));
    }
    return tasks;
  }

  async open(signerPublicId: string, userId: number) {
    return this.mysql.transaction(async (manager) => {
      const signer = await this.signers.findByPublicIdForUpdate(
        signerPublicId,
        manager,
      );
      const document = signer
        ? await this.documents.findByIdForUpdate(signer.documentId, manager)
        : null;
      if (!document || !signer) {
        this.access.checkEsignCreator(null, userId);
        throw new Error('unreachable');
      }
      this.access.assertInternalSigner(document, signer, userId);
      this.validation.assertSignerCanReadSource(document, signer, new Date());
      await this.audit.append(
        {
          documentId: document.id,
          signerId: signer.id,
          actorUserId: userId,
          eventType: 'document.opened',
          occurredAt: new Date(),
        },
        manager,
      );
      return this.toTask(document, signer, manager);
    });
  }

  async source(signerPublicId: string, userId: number) {
    const manager = this.mysql.getManager();
    const signer = await this.signers.findByPublicId(signerPublicId, manager);
    const document = signer
      ? await this.documents.findById(signer.documentId, manager)
      : null;
    if (!document || !signer) {
      this.access.checkEsignCreator(null, userId);
      throw new Error('unreachable');
    }
    this.access.assertInternalSigner(document, signer, userId);
    this.validation.assertSignerCanReadSource(document, signer, new Date());
    const source = await this.files.findDocumentFile(
      document.id,
      'source_pdf',
      manager,
    );
    if (!source) return null;
    const bytes = await readPrivateFile(this.storage, source);
    const metadata = await this.pdf.validatePersistedPdf(bytes);
    this.validation.assertSourceIntegrity(document, source, metadata.sha256);
    return { bytes, fileName: source.originalFileName ?? 'document.pdf' };
  }

  private async toTask(
    document: NonNullable<Awaited<ReturnType<DocumentRepository['findById']>>>,
    signer: NonNullable<
      Awaited<ReturnType<SignerRepository['findByPublicId']>>
    >,
    manager = this.mysql.getManager(),
  ) {
    const [allSigners, allFields] = await Promise.all([
      this.signers.findByDocument(document.id, manager),
      this.fields.findByDocument(document.id, manager),
    ]);
    const counts = {
      pendingCount: allSigners.filter((item) => item.status === 'pending')
        .length,
      signedCount: allSigners.filter((item) => item.status === 'signed').length,
    };
    return {
      signerPublicId: signer.publicId,
      document: this.mapper.documentSummary(document, counts),
      signer: this.mapper.signer(signer, null),
      fields: allFields
        .filter((field) => field.signerId === signer.id)
        .map((field) => this.mapper.field(field, signer.publicId)),
      consent: this.consent.getActive(),
      ...counts,
    };
  }
}
