import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { Inject, Injectable } from '@nestjs/common';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { readPrivateFile } from '#app/infrastructure/file-storage/read-private-file';
import {
  INVITATION_MAIL_SENDER,
  type InvitationMailSender,
} from '#app/infrastructure/mail/invitation-mail-sender.port';
import { DocumentFieldRepository } from '../repositories/document-field.repository';
import { DocumentRepository } from '../repositories/document.repository';
import { FileObjectRepository } from '../repositories/file-object.repository';
import { SignerRepository } from '../repositories/signer.repository';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import {
  EsignAuditService,
  type EsignAuditMetadata,
} from './esign-audit.service';
import { EsignCompletionAccessService } from './esign-completion-access.service';
import { EsignConsentService } from './esign-consent.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { EsignTokenService } from './esign-token.service';
import { EsignViewMapper } from './esign-view.mapper';
import { ExternalOtpService, type OtpIssue } from './external-otp.service';
import { PdfValidationService } from './pdf-validation.service';

export type ExternalSessionResult =
  | { verified: true; signerPublicId: string }
  /** remainingAttempts 為 0 表示驗證碼已失效（過期、已使用或錯滿），需重新取得 */
  | { verified: false; email: string; remainingAttempts: number };

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
    private readonly otp: ExternalOtpService,
    @Inject(INVITATION_MAIL_SENDER)
    private readonly mailer: InvitationMailSender,
  ) {}

  isTokenFormat(token: string): boolean {
    return /^[A-Za-z0-9_-]{43}$/.test(token);
  }

  /**
   * 按下「開啟電子簽署文件」或「重新寄送驗證碼」：先做存取檢查（失效 401、尚未開始 409，都不寄信），
   * 通過後寄驗證碼到邀請信箱並記錄寄出；冷卻中或已達每小時上限時不寄送、不記錄。
   * 回傳收件信箱供輸入頁遮罩顯示，以及寄送結果供顯示可再寄送的時間。
   */
  async sendOtp(token: string): Promise<{ email: string; issue: OtpIssue }> {
    const { signer, document } = await this.readAccess(token);
    const email = invitationEmail(signer);
    const issue = await this.otp.issue(signer.id, async (code) => {
      try {
        await this.mailer.sendOtp({
          recipientEmail: email,
          documentTitle: document.title,
          code,
        });
      } catch {
        // SMTP 錯誤可能帶回收件內容，不記錄原始錯誤
        throw new AppException(...AppErrors.ESIGN_OTP_MAIL_FAILED);
      }
    });
    if (issue.status !== 'sent') return { email, issue };
    await this.mysql.transaction((manager) =>
      this.audit.append(
        {
          documentId: document.id,
          signerId: signer.id,
          eventType: 'external_otp.sent',
          occurredAt: new Date(),
        },
        manager,
      ),
    );
    return { email, issue };
  }

  /**
   * 以邀請憑證＋驗證碼建立外部存取。邀請失效（401）或尚未開始（409）時不比對驗證碼；
   * 驗證成功記錄 external_otp.verified 與 external_invitation.opened，錯誤記錄 failed／locked。
   */
  async createSession(
    token: string,
    code: string,
  ): Promise<ExternalSessionResult> {
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
      const append = (eventType: string, metadata?: EsignAuditMetadata) =>
        this.audit.append(
          {
            documentId: document.id,
            signerId: signer.id,
            eventType,
            occurredAt: new Date(),
            metadata,
          },
          manager,
        );
      const verification = await this.otp.verify(signer.id, code);
      if (verification.status === 'verified') {
        await append('external_otp.verified');
        await append('external_invitation.opened');
        return { verified: true, signerPublicId: signer.publicId };
      }
      const email = invitationEmail(signer);
      if (verification.status === 'wrong') {
        const { remainingAttempts } = verification;
        await append('external_otp.failed', { remainingAttempts });
        return { verified: false, email, remainingAttempts };
      }
      if (verification.status === 'locked') await append('external_otp.locked');
      return { verified: false, email, remainingAttempts: 0 };
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

/** 外部存取檢查已確認為 email 簽署人，DB CHECK 保證有 email */
function invitationEmail(signer: { email?: string }): string {
  if (!signer.email) throw new Error('unreachable');
  return signer.email;
}
