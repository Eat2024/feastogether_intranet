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
import { EsignTokenService } from './esign-token.service';
import { EsignViewMapper } from './esign-view.mapper';
import { PdfValidationService } from './pdf-validation.service';

@Injectable()
export class ExternalAccessService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly documents: DocumentRepository,
    private readonly signers: SignerRepository,
    private readonly fields: DocumentFieldRepository,
    private readonly files: FileObjectRepository,
    private readonly tokens: EsignTokenService,
    private readonly access: EsignAccessPolicyService,
    private readonly validation: EsignDocumentValidationService,
    private readonly consent: EsignConsentService,
    private readonly mapper: EsignViewMapper,
    private readonly pdf: PdfValidationService,
    private readonly audit: EsignAuditService,
    @Inject(PRIVATE_FILE_STORAGE)
    private readonly storage: PrivateFileStorage,
  ) {}

  isTokenFormat(token: string): boolean {
    return /^[A-Za-z0-9_-]{43}$/.test(token);
  }

  async createSession(token: string) {
    const digest = this.tokens.digest(token);
    return this.mysql.transaction(async (manager) => {
      const signer = await this.signers.findByInvitationDigestForUpdate(
        digest,
        manager,
      );
      const document = signer
        ? await this.documents.findByIdForUpdate(signer.documentId, manager)
        : null;
      if (!signer || !document) {
        this.access.assertExternalInvitation(
          document,
          signer,
          digest,
          new Date(),
        );
        throw new Error('unreachable');
      }
      this.access.assertExternalInvitation(
        document,
        signer,
        digest,
        new Date(),
      );
      await this.audit.append(
        {
          documentId: document.id,
          signerId: signer.id,
          eventType: 'external_invitation.opened',
          occurredAt: new Date(),
        },
        manager,
      );
      return {
        signerPublicId: signer.publicId,
        invitationExpiresAt: signer.invitationExpiresAt!,
      };
    });
  }

  async task(token: string, appendOpened: boolean) {
    const digest = this.tokens.digest(token);
    const run = async (manager: ReturnType<MysqlService['getManager']>) => {
      const signer = await this.signers.findByInvitationDigest(digest, manager);
      const document = signer
        ? await this.documents.findById(signer.documentId, manager)
        : null;
      if (!signer || !document) {
        this.access.assertExternalInvitation(
          document,
          signer,
          digest,
          new Date(),
        );
        throw new Error('unreachable');
      }
      this.access.assertExternalInvitation(
        document,
        signer,
        digest,
        new Date(),
      );
      if (appendOpened) {
        await this.audit.append(
          {
            documentId: document.id,
            signerId: signer.id,
            eventType: 'document.opened',
            occurredAt: new Date(),
          },
          manager,
        );
      }
      const [allSigners, allFields] = await Promise.all([
        this.signers.findByDocument(document.id, manager),
        this.fields.findByDocument(document.id, manager),
      ]);
      const counts = {
        pendingCount: allSigners.filter((item) => item.status === 'pending')
          .length,
        signedCount: allSigners.filter((item) => item.status === 'signed')
          .length,
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
    };
    return appendOpened
      ? this.mysql.transaction(run)
      : run(this.mysql.getManager());
  }

  async source(token: string) {
    const digest = this.tokens.digest(token);
    const manager = this.mysql.getManager();
    const signer = await this.signers.findByInvitationDigest(digest, manager);
    const document = signer
      ? await this.documents.findById(signer.documentId, manager)
      : null;
    if (!signer || !document) {
      this.access.assertExternalInvitation(
        document,
        signer,
        digest,
        new Date(),
      );
      throw new Error('unreachable');
    }
    this.access.assertExternalInvitation(document, signer, digest, new Date());
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

  async signingSignerPublicId(token: string): Promise<string> {
    const digest = this.tokens.digest(token);
    const manager = this.mysql.getManager();
    const signer = await this.signers.findByInvitationDigest(digest, manager);
    const document = signer
      ? await this.documents.findById(signer.documentId, manager)
      : null;
    this.access.assertExternalCredential(document, signer, digest);
    return signer.publicId;
  }
}
