import type { Actor } from '#app/features/auth/auth.types';
import { AuthorizationService } from '#app/features/authorization/services/authorization.service';
import { EsignExportService } from './esign-export.service';
import type { EsignSigner } from '../entities/esign-signer.entity';
import type { EsignNotificationLog } from '../entities/esign-notification-log.entity';
import { reminderEligibility } from './esign-reminder-policy';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { EsignTokenService } from './esign-token.service';
import { Inject, Injectable } from '@nestjs/common';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { readPrivateFile } from '#app/infrastructure/file-storage/read-private-file';
import type {
  EsignDocumentDetailDto,
  EsignSourceFileDto,
  EsignInvitationDelivery,
} from '../dto/esign-common.dto';
import type { EsignDocument } from '../entities/esign-document.entity';
import { DocumentFieldRepository } from '../repositories/document-field.repository';
import { DocumentRepository } from '../repositories/document.repository';
import { FileObjectRepository } from '../repositories/file-object.repository';
import { NotificationRepository } from '../repositories/notification.repository';
import { SignatureRecordRepository } from '../repositories/signature-record.repository';
import { SignerRepository } from '../repositories/signer.repository';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { EsignViewMapper } from './esign-view.mapper';
import { PdfValidationService } from './pdf-validation.service';

@Injectable()
export class EsignDocumentQueryService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly documents: DocumentRepository,
    private readonly signers: SignerRepository,
    private readonly fields: DocumentFieldRepository,
    private readonly files: FileObjectRepository,
    private readonly notifications: NotificationRepository,
    private readonly policy: EsignAccessPolicyService,
    private readonly validation: EsignDocumentValidationService,
    private readonly mapper: EsignViewMapper,
    private readonly pdf: PdfValidationService,
    @Inject(PRIVATE_FILE_STORAGE)
    private readonly storage: PrivateFileStorage,
    private readonly users: UserRepository,
    private readonly records: SignatureRecordRepository,
    private readonly tokens: EsignTokenService,
    private readonly exports: EsignExportService,
    private readonly authorization: AuthorizationService,
  ) {}

  private reminderSummary(
    document: EsignDocument,
    signer: EsignSigner,
    logs: EsignNotificationLog[],
  ) {
    const now = new Date();
    const reasonCode = reminderEligibility(document, signer, logs, now);
    const latest = logs.find((l) => l.batch?.kind === 'reminder');
    const invitation = logs.find(
      (l) =>
        l.batch?.kind === 'invitation' &&
        l.errorCode !== 'INVITATION_SUPERSEDED' &&
        (signer.signerType === 'user' ||
          (!!l.invitationGenerationSha256 &&
            l.invitationGenerationSha256 === signer.invitationTokenSha256)),
    );
    const midnight = new Date(now.getTime() + 8 * 60 * 60_000);
    midnight.setUTCHours(24, 0, 0, 0);
    return {
      reminderEligibility: {
        eligible: reasonCode === null,
        reasonCode,
        nextEligibleAt:
          reasonCode === 'REMINDER_DAILY_LIMIT'
            ? new Date(midnight.getTime() - 8 * 60 * 60_000).toISOString()
            : null,
      },
      latestInvitation: invitation
        ? {
            status: invitation.result,
            completedAt: invitation.completedAt?.toISOString() ?? null,
            reasonCode: invitation.errorCode ?? null,
          }
        : null,
      latestReminder: latest
        ? {
            status: latest.result,
            completedAt: latest.completedAt?.toISOString() ?? null,
            reasonCode: latest.errorCode ?? null,
          }
        : null,
      deliveredReminderCount: logs.filter(
        (l) => l.batch?.kind === 'reminder' && l.result === 'delivered',
      ).length,
    };
  }

  async list(
    actor: Actor,
    role?: 'dep' | 'created' | 'assigned' | 'all',
    status?:
      | 'initiating'
      | 'draft'
      | 'active'
      | 'expired'
      | 'finalizing'
      | 'completed'
      | 'stopped',
  ) {
    return this.mysql.transaction(async (manager) => {
      await this.authorization.requirePermissions(
        actor,
        ['esign.document.read'],
        manager,
      );
      role ??= actor.kind === 'super_user' ? 'all' : undefined;
      if (role === 'all')
        await this.authorization.requirePermissions(
          actor,
          ['esign.document.read-all'],
          manager,
        );
      if (actor.kind === 'super_user' && role !== 'all')
        throw new AppException(...AppErrors.AUTHORIZATION_DENIED);
      const userId = actor.kind === 'employee' ? actor.userId : undefined;
      const now = new Date();
      const department =
        role === 'dep' && userId !== undefined
          ? await this.policy.requireDepartment(userId, manager)
          : null;
      const [created, assignedSigners] = await Promise.all([
        role === 'all'
          ? this.documents.findAllForList(manager)
          : department
            ? this.documents.findByDepartment(
                department.departmentCode,
                manager,
              )
            : role === 'assigned' || userId === undefined
              ? Promise.resolve([])
              : this.documents.findListCreatedByUser(userId, manager),
        role === 'created' ||
        role === 'dep' ||
        role === 'all' ||
        userId === undefined
          ? Promise.resolve([])
          : this.signers.findAssignedToUser(userId, manager),
      ]);
      const assigned = (
        await this.documents.findListByIds(
          [...new Set(assignedSigners.map((signer) => signer.documentId))],
          manager,
        )
      ).filter((document) => document.status !== 'draft');
      const byId = new Map(
        [...created, ...assigned].map((document) => [document.id, document]),
      );
      const documents = [...byId.values()].sort(
        (left, right) =>
          right.updatedAt.getTime() - left.updatedAt.getTime() ||
          right.id - left.id,
      );
      const creatorIds = [
        ...new Set(
          documents.flatMap((d) =>
            d.createdByUserId === null ? [] : [d.createdByUserId],
          ),
        ),
      ];
      const [creatorRows, countsByDocument] = await Promise.all([
        this.users.findByIds(creatorIds, manager),
        this.signers.countsByDocumentIds(
          documents.map((d) => d.id),
          manager,
        ),
      ]);
      const creators = new Map(creatorRows.map((user) => [user.id, user]));
      const items = documents.map((document) =>
        this.mapper.documentListItem(
          document,
          countsByDocument.get(document.id) ?? {
            pendingCount: 0,
            signedCount: 0,
          },
          document.createdByUserId === null
            ? undefined
            : creators.get(document.createdByUserId),
          now,
          userId,
        ),
      );
      return items.filter((document) => !status || document.status === status);
    }, 'REPEATABLE READ');
  }

  async detail(
    documentId: number,
    actor: Actor,
  ): Promise<EsignDocumentDetailDto> {
    const manager = this.mysql.getManager();
    const document = await this.documents.findById(documentId, manager);
    const readable = await this.policy.readableForActor(
      document,
      actor,
      manager,
    );
    const canManage = await this.policy.canManageDocument(
      readable,
      actor,
      manager,
    );
    const isCreator =
      actor.kind === 'employee' && readable.createdByUserId === actor.userId;
    const [signers, fields, source, creator, canExport] = await Promise.all([
      this.signers.findByDocument(documentId, manager),
      canManage
        ? this.fields.findByDocument(documentId, manager)
        : Promise.resolve([]),
      this.files.findDocumentFile(documentId, 'source_pdf', manager),
      readable.createdByUserId === null
        ? Promise.resolve(null)
        : this.users.findById(readable.createdByUserId, manager),
      this.canExportDocument(readable, actor),
    ]);
    let sourceFile: EsignSourceFileDto | undefined;
    if (source) {
      const bytes = await readPrivateFile(this.storage, source);
      const metadata = await this.pdf.validatePersistedPdf(bytes);
      this.validation.assertSourceIntegrity(readable, source, metadata.sha256);
      sourceFile = this.mapper.sourceFile(source, metadata.pageCount);
    }
    const summary = this.mapper.documentSummary(readable, this.count(signers));
    const common = {
      ...summary,
      canExport,
      exportSummary: canExport
        ? await this.exports.documentSummary(documentId, actor)
        : null,
      sourceFile,
      signStartAt: readable.signStartAt?.toISOString() ?? null,
      signEndAt: readable.signEndAt?.toISOString() ?? null,
      stopReason: readable.stopReason ?? null,
      createdBy: this.mapper.creator(creator, readable.createdByActorKind),
    };
    if (!canManage) {
      return {
        ...common,
        isCreator,
        canManage: false,
        signers: signers.map((signer) => this.mapper.readonlySigner(signer)),
      };
    }
    const signerIds = signers.map((signer) => signer.id);
    const [logs, records] = await Promise.all([
      this.notifications.findBySignerIds(signerIds, manager),
      this.records.findBySignerIds(signerIds, manager),
    ]);
    const codeBySigner = new Map(
      records.map((record) => [record.signerId, record.verificationCode]),
    );
    const deliveryBySigner = new Map<number, EsignInvitationDelivery>();
    const generationBySigner = new Map(
      signers.map((signer) => [signer.id, signer.invitationTokenSha256]),
    );
    const internalSignerIds = new Set(
      signers
        .filter((signer) => signer.signerType === 'user')
        .map((signer) => signer.id),
    );
    for (const log of logs) {
      if (log.errorCode === 'INVITATION_SUPERSEDED') continue;
      if (log.batch?.kind === 'reminder') continue;
      if (
        !internalSignerIds.has(log.signerId) &&
        (!log.invitationGenerationSha256 ||
          log.invitationGenerationSha256 !==
            generationBySigner.get(log.signerId))
      )
        continue;
      if (!deliveryBySigner.has(log.signerId)) {
        const result: EsignInvitationDelivery =
          log.result === 'delivered'
            ? 'delivered'
            : log.result === 'failed'
              ? 'failed'
              : log.result === 'skipped'
                ? 'skipped'
                : log.result === 'unknown'
                  ? 'unknown'
                  : log.result === 'processing'
                    ? 'processing'
                    : 'pending';
        deliveryBySigner.set(log.signerId, result);
      }
    }
    return {
      ...common,
      isCreator,
      canManage: true,
      watermark: readable.watermarkEnabled,
      allowReject: readable.allowReject,
      signers: signers.map((signer) => ({
        ...this.mapper.signer(
          signer,
          deliveryBySigner.get(signer.id) ?? null,
          codeBySigner.get(signer.id),
        ),
        ...this.reminderSummary(
          readable,
          signer,
          logs.filter((l) => l.signerId === signer.id),
        ),
        note: signer.note ?? '',
      })),
      fields: fields.map((field) => this.mapper.field(field)),
    };
  }

  reopeningInvitations(documentId: number, actor: Actor) {
    return this.mysql.transaction(async (manager) => {
      const document = await this.policy.manageableDocument(
        await this.documents.findById(documentId, manager),
        actor,
        manager,
      );
      const signers = await this.signers.findByDocument(documentId, manager);
      const now = new Date();
      const summary = this.mapper.documentSummary(
        document,
        this.count(signers),
        now,
      );
      if (summary.status !== 'active' || !summary.isReopened) return [];
      return signers
        .filter(
          (signer) =>
            signer.signerType === 'email' &&
            signer.status === 'pending' &&
            !!signer.invitationTokenCiphertext,
        )
        .map((signer) => {
          try {
            if (
              !signer.invitationTokenCiphertext ||
              !signer.invitationExpiresAt ||
              signer.invitationExpiresAt <= now ||
              !document.signEndAt ||
              signer.invitationExpiresAt > document.signEndAt
            )
              throw new Error();
            const token = this.tokens.decrypt(signer.invitationTokenCiphertext);
            if (this.tokens.digest(token) !== signer.invitationTokenSha256)
              throw new Error();
            return {
              signerPublicId: signer.publicId,
              invitationUrl: this.tokens.invitationUrl(token),
              expiresAt: signer.invitationExpiresAt.toISOString(),
            };
          } catch {
            throw new AppException(
              ...AppErrors.ESIGN_INVITATION_SERVICE_UNAVAILABLE,
            );
          }
        });
    });
  }

  async source(documentId: number, actor: Actor) {
    const manager = this.mysql.getManager();
    const document = await this.documents.findById(documentId, manager);
    const readable = await this.policy.readableForActor(
      document,
      actor,
      manager,
    );
    const source = await this.files.findDocumentFile(
      documentId,
      'source_pdf',
      manager,
    );
    if (!source) return null;
    const bytes = await readPrivateFile(this.storage, source);
    const metadata = await this.pdf.validatePersistedPdf(bytes);
    this.validation.assertSourceIntegrity(readable, source, metadata.sha256);
    return { bytes, fileName: source.originalFileName ?? 'document.pdf' };
  }

  /** 匯出資料與一般詳情分離授權，不產生匯出紀錄或回傳管理憑證。 */
  async exportDocument(documentId: number, actor: Actor) {
    await this.authorization.requirePermissions(actor, ['esign.export.read']);
    const manager = this.mysql.getManager();
    const document = await this.policy.exportDocument(
      await this.documents.findById(documentId, manager),
      actor,
      'esign.export.read',
      manager,
    );
    if (document.status === 'draft') {
      throw new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
    }
    const [creator, signers] = await Promise.all([
      document.createdByUserId === null
        ? Promise.resolve(null)
        : this.users.findById(document.createdByUserId, manager),
      this.signers.findByDocument(documentId, manager),
    ]);
    return {
      ...this.mapper.excelExportDocument(document, creator, signers),
      exportSummary: await this.exports.documentSummary(documentId, actor),
      status: this.mapper.documentSummary(document, this.count(signers)).status,
    };
  }

  /** UI 旗標也要有匯出能力；只有缺能力可轉 false，目錄或 DB 故障仍拒絕。 */
  private async canExportDocument(document: EsignDocument, actor: Actor) {
    try {
      await this.policy.exportDocument(
        document,
        actor,
        'esign.export.read',
        this.mysql.getManager(),
      );
      return true;
    } catch (error) {
      if (
        error instanceof AppException &&
        [
          'AUTHORIZATION_DENIED',
          'ESIGN_RESOURCE_NOT_FOUND',
          'ESIGN_DEPARTMENT_UNAVAILABLE',
        ].includes(error.code)
      )
        return false;
      throw error;
    }
  }

  private count(signers: Array<{ status: string }>) {
    return {
      pendingCount: signers.filter((signer) => signer.status === 'pending')
        .length,
      signedCount: signers.filter((signer) => signer.status === 'signed')
        .length,
    };
  }
}
