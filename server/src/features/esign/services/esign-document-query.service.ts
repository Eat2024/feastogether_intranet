import type { EsignSigner } from '../entities/esign-signer.entity';
import type { EsignNotificationLog } from '../entities/esign-notification-log.entity';
import { reminderEligibility } from './esign-reminder-policy';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { EsignTokenService } from './esign-token.service';
import { Inject, Injectable } from '@nestjs/common';
import type { User } from '#app/features/users/entities/user.entity';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { readPrivateFile } from '#app/infrastructure/file-storage/read-private-file';
import type { EsignInvitationDelivery } from '../dto/esign-common.dto';
import type { EsignDocument } from '../entities/esign-document.entity';
import { AuditEventRepository } from '../repositories/audit-event.repository';
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
    private readonly audits: AuditEventRepository,
    private readonly policy: EsignAccessPolicyService,
    private readonly validation: EsignDocumentValidationService,
    private readonly mapper: EsignViewMapper,
    private readonly pdf: PdfValidationService,
    @Inject(PRIVATE_FILE_STORAGE)
    private readonly storage: PrivateFileStorage,
    private readonly users: UserRepository,
    private readonly records: SignatureRecordRepository,
    private readonly tokens: EsignTokenService,
  ) {}

  private reminderSummary(
    document: EsignDocument,
    signer: EsignSigner,
    logs: EsignNotificationLog[],
  ) {
    const now = new Date();
    const reasonCode =
      reminderEligibility(document, signer, logs, now) ??
      (!signer.email || !signer.invitationTokenSha256
        ? 'RECIPIENT_UNAVAILABLE'
        : null);
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
    userId: number,
    role?: 'created' | 'assigned',
    status?:
      | 'draft'
      | 'active'
      | 'expired'
      | 'finalizing'
      | 'completed'
      | 'stopped',
  ) {
    const now = new Date();
    const manager = this.mysql.getManager();
    const [created, assignedSigners] = await Promise.all([
      role === 'assigned'
        ? Promise.resolve([])
        : this.documents.findCreatedByUser(userId, manager),
      role === 'created'
        ? Promise.resolve([])
        : this.signers.findAssignedToUser(userId, manager),
    ]);
    const assigned = (
      await Promise.all(
        assignedSigners.map((signer) =>
          this.documents.findById(signer.documentId, manager),
        ),
      )
    )
      .filter((document): document is EsignDocument => document !== null)
      .filter((document) => document.status !== 'draft');
    const byId = new Map(
      [...created, ...assigned].map((document) => [document.id, document]),
    );
    const documents = [...byId.values()].sort(
      (left, right) =>
        right.updatedAt.getTime() - left.updatedAt.getTime() ||
        right.id - left.id,
    );
    // 建立人：同一人只查一次
    const creatorIds = [...new Set(documents.map((d) => d.createdByUserId))];
    const creators = new Map(
      (
        await Promise.all(
          creatorIds.map((id) => this.users.findById(id, manager)),
        )
      )
        .filter((user): user is User => user !== null)
        .map((user) => [user.id, user]),
    );
    const items = await Promise.all(
      documents.map(async (document) => {
        const signers = await this.signers.findByDocument(document.id, manager);
        return this.mapper.documentListItem(
          document,
          this.count(signers),
          creators.get(document.createdByUserId),
          now,
        );
      }),
    );
    return items.filter((document) => !status || document.status === status);
  }

  async creatorDetail(documentId: number, userId: number) {
    const manager = this.mysql.getManager();
    const document = await this.documents.findById(documentId, manager);
    this.policy.checkEsignCreator(document, userId);
    const [signers, fields, source, creator] = await Promise.all([
      this.signers.findByDocument(documentId, manager),
      this.fields.findByDocument(documentId, manager),
      this.files.findDocumentFile(documentId, 'source_pdf', manager),
      this.users.findById(document.createdByUserId, manager),
    ]);
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
        const result =
          log.result === 'delivered'
            ? 'delivered'
            : log.result === 'failed'
              ? 'failed'
              : 'pending';
        deliveryBySigner.set(log.signerId, result);
      }
    }
    let sourceFile;
    if (source) {
      const bytes = await readPrivateFile(this.storage, source);
      const metadata = await this.pdf.validatePersistedPdf(bytes);
      this.validation.assertSourceIntegrity(document, source, metadata.sha256);
      sourceFile = this.mapper.sourceFile(source, metadata.pageCount);
    }
    const summary = this.mapper.documentSummary(document, this.count(signers));
    return {
      ...summary,
      sourceFile,
      signStartAt: document.signStartAt?.toISOString() ?? null,
      signEndAt: document.signEndAt?.toISOString() ?? null,
      watermark: document.watermarkEnabled,
      allowReject: document.allowReject,
      stopReason: document.stopReason ?? null,
      createdBy: this.mapper.creator(creator),
      signers: signers.map((signer) => ({
        ...this.mapper.signer(
          signer,
          deliveryBySigner.get(signer.id) ?? null,
          codeBySigner.get(signer.id),
        ),
        ...this.reminderSummary(
          document,
          signer,
          logs.filter((l) => l.signerId === signer.id),
        ),
        note: signer.note ?? '',
      })),
      fields: fields.map((field) => this.mapper.field(field)),
    };
  }

  reopeningInvitations(documentId: number, userId: number) {
    return this.mysql.transaction(async (manager) => {
      const document = await this.documents.findById(documentId, manager);
      this.policy.checkEsignCreator(document, userId);
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
            signer.status === 'pending' && !!signer.invitationTokenCiphertext,
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

  async creatorSource(documentId: number, userId: number) {
    const manager = this.mysql.getManager();
    const document = await this.documents.findById(documentId, manager);
    this.policy.checkEsignCreator(document, userId);
    const source = await this.files.findDocumentFile(
      documentId,
      'source_pdf',
      manager,
    );
    if (!source) return null;
    const bytes = await readPrivateFile(this.storage, source);
    const metadata = await this.pdf.validatePersistedPdf(bytes);
    this.validation.assertSourceIntegrity(document, source, metadata.sha256);
    return { bytes, fileName: source.originalFileName ?? 'document.pdf' };
  }

  async history(documentId: number, userId: number) {
    const manager = this.mysql.getManager();
    const document = await this.documents.findById(documentId, manager);
    const signers = document
      ? await this.signers.findByDocument(documentId, manager)
      : [];
    const signer = signers.find((candidate) => candidate.userId === userId);
    if (!document || (document.createdByUserId !== userId && !signer)) {
      this.policy.checkEsignCreator(document, userId);
    }
    const events = await this.audits.findDocumentEvents(documentId, manager);
    const isCreator = document?.createdByUserId === userId;
    const bySignerId = new Map(signers.map((item) => [item.id, item]));
    const actorIds = [
      ...new Set(
        events.flatMap((event) =>
          event.actorUserId ? [event.actorUserId] : [],
        ),
      ),
    ];
    const actors = new Map(
      (
        await Promise.all(
          actorIds.map((id) => this.users.findById(id, manager)),
        )
      )
        .filter((user): user is User => user !== null)
        .map((user) => [user.id, user]),
    );
    const documentEvents = new Set([
      'document.created',
      'document.initiated',
      'document.completed',
      'document.stopped_by_creator',
      'document.stopped_by_deadline',
      'document.expired',
      'document.reopened',
    ]);
    return events
      .filter(
        (event) =>
          isCreator ||
          documentEvents.has(event.eventType) ||
          event.signerId === signer?.id,
      )
      .map((event) => {
        if (event.eventType === 'document.reopened') {
          const base = {
            type: event.eventType,
            occurredAt: event.occurredAt.toISOString(),
            signEndAt: event.metadataJson?.signEndAt,
          };
          return isCreator
            ? {
                ...base,
                actor: '建立人',
                actorUserId: String(event.actorUserId),
                previousSignEndAt: event.metadataJson?.previousSignEndAt,
                reason: event.metadataJson?.reason,
              }
            : base;
        }
        return {
          type: event.eventType,
          occurredAt: event.occurredAt.toISOString(),
          actor: this.mapper.historyActor(
            event,
            event.signerId ? bySignerId.get(event.signerId) : undefined,
            event.actorUserId ? actors.get(event.actorUserId) : undefined,
          ),
          reason:
            typeof event.metadataJson?.reason === 'string'
              ? event.metadataJson.reason
              : null,
        };
      });
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
