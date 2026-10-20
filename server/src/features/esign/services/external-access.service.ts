import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
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
import { EsignCompletionAccessService } from './esign-completion-access.service';
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
    private readonly completions: EsignCompletionAccessService,
  ) {}

  isTokenFormat(token: string): boolean {
    return /^[A-Za-z0-9_-]{43}$/.test(token);
  }

  /**
   * 以邀請憑證建立外部存取並記錄開啟。
   * 待簽者回傳邀請期限（帶期限的 cookie）；已簽者不設期限，回傳 null（session cookie）。
   */
  async createSession(token: string) {
    const digest = this.tokens.digest(token);
    return this.mysql.transaction(async (manager) => {
      const candidate = await this.signers.findByInvitationDigest(
        digest,
        manager,
      );
      const document = candidate
        ? await this.documents.findByIdForUpdate(candidate.documentId, manager)
        : null;
      const signer = document
        ? await this.signers.findByInvitationDigestForUpdate(digest, manager)
        : null;
      this.access.assertExternalAccess(document, signer, digest, new Date());
      if (!signer || !document) throw new Error('unreachable');
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
        invitationExpiresAt: signer.invitationExpiresAt,
      };
    });
  }

  async task(token: string, appendOpened: boolean) {
    const digest = this.tokens.digest(token);
    const run = async (manager: ReturnType<MysqlService['getManager']>) => {
      const candidate = await this.signers.findByInvitationDigest(
        digest,
        manager,
      );
      const document = candidate
        ? appendOpened
          ? await this.documents.findByIdForUpdate(
              candidate.documentId,
              manager,
            )
          : await this.documents.findById(candidate.documentId, manager)
        : null;
      const signer =
        document && appendOpened
          ? await this.signers.findByInvitationDigestForUpdate(digest, manager)
          : candidate;
      if (!signer || !document) {
        this.access.assertExternalAccess(document, signer, digest, new Date());
        throw new Error('unreachable');
      }
      this.access.assertExternalAccess(document, signer, digest, new Date());
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
      const [totals, allFields] = await Promise.all([
        this.signers.completionCounts(document.id, manager),
        this.fields.findByDocument(document.id, manager),
      ]);
      const counts = {
        pendingCount: totals.pending,
        signedCount: totals.signed,
      };
      return {
        signerPublicId: signer.publicId,
        document: this.mapper.documentSummary(document, counts),
        signer: this.mapper.signer(signer, null),
        fields: allFields.map((field) => this.mapper.field(field)),
        consent: this.consent.getActive(),
        ...counts,
      };
    };
    return appendOpened
      ? this.mysql.transaction(run)
      : run(this.mysql.getManager());
  }

  async source(token: string) {
    const { document, manager } = await this.readAccess(token);
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

  /** 本人副本：只限已簽者；未產生時回傳 null */
  async completedFile(token: string) {
    const { signer, document } = await this.readAccess(token);
    if (signer.status !== 'signed')
      throw new AppException(...AppErrors.ESIGN_EXTERNAL_UNAUTHORIZED);
    return this.completions.personalCopy(document, signer);
  }

  async signingSignerPublicId(token: string): Promise<string> {
    const { signer } = await this.readAccess(token);
    return signer.publicId;
  }

  /** 以邀請憑證查詢簽署人與文件並驗證外部存取（不鎖定、不寫入） */
  private async readAccess(token: string) {
    const digest = this.tokens.digest(token);
    const manager = this.mysql.getManager();
    const signer = await this.signers.findByInvitationDigest(digest, manager);
    const document = signer
      ? await this.documents.findById(signer.documentId, manager)
      : null;
    this.access.assertExternalAccess(document, signer, digest, new Date());
    if (!signer || !document) throw new Error('unreachable');
    return { signer, document, manager };
  }
}
