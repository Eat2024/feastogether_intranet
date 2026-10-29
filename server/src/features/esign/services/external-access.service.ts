import { NotificationRepository } from '../repositories/notification.repository';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { Inject, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
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
import {
  EsignCompletionAccessService,
  type PersonalCopyDownload,
} from './esign-completion-access.service';
import { EsignConsentService } from './esign-consent.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { EsignTokenService } from './esign-token.service';
import type { SigningPrincipal } from './esign-signing.service';
import { EsignViewMapper } from './esign-view.mapper';
import { ExternalAccessCredentialService } from './external-access-credential.service';
import {
  ExternalOtpService,
  OTP_TTL_SECONDS,
  type OtpIssue,
} from './external-otp.service';
import { PdfValidationService } from './pdf-validation.service';

export type ExternalSessionResult =
  /** credential 為新建立的存取憑證，只放進 cookie */
  | { verified: true; signerPublicId: string; credential: string }
  /** remainingAttempts 為 0 表示驗證碼已失效（過期、已使用或錯滿），需重新取得 */
  | { verified: false; email: string; remainingAttempts: number };

/** 邀請確認後的表單以邀請 token 找簽署人；驗證碼通過後的端點以存取憑證找簽署人 */
type SignerKey = { invitationToken: string } | { credential: string };

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
    private readonly credentials: ExternalAccessCredentialService,
    private readonly notifications: NotificationRepository,
  ) {}

  isTokenFormat(token: string): boolean {
    return /^[A-Za-z0-9_-]{43}$/.test(token);
  }

  /**
   * 按下「開啟電子簽署文件」或「重新寄送驗證碼」：先做存取檢查（失效 401、尚未開始 409，都不寄信），
   * 通過後寄驗證碼到邀請信箱並記錄寄出；冷卻中、已達每小時上限或寄信失敗時不記錄。
   * 回傳收件信箱供輸入頁遮罩顯示，以及寄送結果供顯示可再寄送的時間或寄送失敗頁。
   */
  async sendOtp(token: string): Promise<{ email: string; issue: OtpIssue }> {
    const { signer, document } = await this.checkedAccess(
      { invitationToken: token },
      this.mysql.getManager(),
    );
    const email = invitationEmail(signer);
    const issue = await this.otp.issue(signer.id, (code) =>
      this.mailer.sendOtp({
        recipientEmail: email,
        documentTitle: document.title,
        code,
        validMinutes: OTP_TTL_SECONDS / 60,
      }),
    );
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
   * 以邀請 token＋驗證碼建立外部存取。邀請失效（401）或尚未開始（409）時不比對驗證碼；
   * 驗證成功記錄 external_otp.verified 與 external_invitation.opened 並建立存取憑證，錯誤記錄 failed／locked。
   */
  async createSession(
    token: string,
    code: string,
  ): Promise<ExternalSessionResult> {
    return this.mysql.transaction(async (manager) => {
      const { signer, document } = await this.checkedAccess(
        { invitationToken: token },
        manager,
        true,
      );
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
        return {
          verified: true,
          signerPublicId: signer.publicId,
          credential: await this.credentials.issue(
            signer.id,
            signer.invitationTokenSha256!,
          ),
        };
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

  /** appendOpened 時在交易內鎖定並記錄開啟；否則為唯讀查詢 */
  async task(credential: string, appendOpened: boolean) {
    const run = async (manager: EntityManager) => {
      const { signer, document } = await this.checkedAccess(
        { credential },
        manager,
        appendOpened,
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
        allowReject: document.allowReject,
        document: this.mapper.documentSummary(document, counts),
        signer: {
          ...this.mapper.signer(signer, null),
          employeeNo: null,
          department: null,
          title: null,
        },
        fields: allFields.map((field) => this.mapper.field(field)),
        consent: this.consent.getActive(),
        ...counts,
      };
    };
    return appendOpened
      ? this.mysql.transaction(run)
      : run(this.mysql.getManager());
  }

  async source(credential: string) {
    const manager = this.mysql.getManager();
    const { document, signer } = await this.checkedAccess(
      { credential },
      manager,
    );
    if (signer.status === 'rejected')
      throw new AppException(...AppErrors.ESIGN_EXTERNAL_UNAUTHORIZED);
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

  /** 本人副本：只限已簽者；未產生時 file 為 null */
  async completedFile(credential: string): Promise<PersonalCopyDownload> {
    const { signer, document } = await this.checkedAccess(
      { credential },
      this.mysql.getManager(),
    );
    if (signer.status !== 'signed')
      throw new AppException(...AppErrors.ESIGN_EXTERNAL_UNAUTHORIZED);
    return {
      signer,
      file: await this.completions.personalCopy(document, signer),
    };
  }

  /**
   * 送出簽名的身分：存取憑證對應的簽署人；憑證不存在或已過期回 401。
   * 先套用外部指派存取政策，簽署服務仍於交易與重送時再次驗證。
   */
  async signingPrincipal(credential: string): Promise<SigningPrincipal> {
    const { signer } = await this.checkedAccess(
      { credential },
      this.mysql.getManager(),
    );
    return {
      kind: 'external',
      signerId: signer.id,
      invitationGenerationSha256: signer.invitationTokenSha256!,
    };
  }

  /** 結束外部存取：刪除存取憑證，之後以同一 cookie 存取一律 401 */
  endSession(credential: string): Promise<void> {
    return this.credentials.revoke(credential);
  }

  /**
   * 找出簽署人與文件並驗證外部存取（失效 401、尚未開始 409）。
   * lock 時依文件 → 簽署人順序鎖定，與停止、簽署流程一致，避免反向鎖定造成 deadlock。
   */
  private async checkedAccess(
    key: SignerKey,
    manager: EntityManager,
    lock = false,
  ) {
    let signer = await this.findSigner(key, manager);
    const document = !signer
      ? null
      : lock
        ? await this.documents.findByIdForUpdate(signer.documentId, manager)
        : await this.documents.findById(signer.documentId, manager);
    if (signer && document && lock) {
      // 文件鎖取得前可能已補簽；用鎖定讀取比對先前驗證的邀請世代。
      const generation = signer.invitationTokenSha256;
      signer = await this.signers.findByIdForUpdate(signer.id, manager);
      if (signer?.invitationTokenSha256 !== generation) signer = null;
    }
    const access = { document, signer };
    this.access.assertExternalAccess(access, new Date());
    return access;
  }

  /** 存取憑證不存在或已過期時找不到簽署人，與邀請失效相同處理 */
  private async findSigner(key: SignerKey, manager: EntityManager) {
    if ('invitationToken' in key) {
      const digest = this.tokens.digest(key.invitationToken);
      const original = await this.signers.findByInvitationDigest(
        digest,
        manager,
      );
      if (original) return original;
      const reminder = await this.notifications.findReminderDigest(
        digest,
        manager,
      );
      const signer = reminder?.signer;
      // 舊內部催簽 token 只用來識別 Portal 引導，不因舊期限或世代授權任何操作。
      if (signer?.signerType === 'user' && !signer.deletedAt) return signer;
      if (
        !reminder ||
        !signer ||
        !['delivered', 'unknown'].includes(reminder.result) ||
        signer.deletedAt ||
        reminder.invitationGenerationSha256 !== signer.invitationTokenSha256
      )
        return null;
      // 已簽本人仍可透過舊信重新 OTP 下載；待簽才檢查提醒期限。
      if (
        signer.status === 'pending' &&
        (!reminder.reminderExpiresAt ||
          new Date() >= reminder.reminderExpiresAt)
      )
        return null;
      return signer;
    }
    const session = await this.credentials.read(key.credential);
    if (!session) return null;
    const signer = await this.signers.findById(session.signerId, manager);
    return signer?.invitationTokenSha256 === session.invitationGenerationSha256
      ? signer
      : null;
  }
}

/** 外部指派的存取檢查已確認固定有效信箱。 */
function invitationEmail(signer: { email?: string | null }): string {
  if (!signer.email) throw new Error('unreachable');
  return signer.email;
}
