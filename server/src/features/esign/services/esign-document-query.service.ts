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
  ) {}

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
    for (const log of logs) {
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
    return {
      ...this.mapper.documentSummary(document, this.count(signers)),
      sourceFile,
      signStartAt: document.signStartAt?.toISOString() ?? null,
      signEndAt: document.signEndAt?.toISOString() ?? null,
      stopReason: document.stopReason ?? null,
      createdBy: this.mapper.creator(creator),
      signers: signers.map((signer) =>
        this.mapper.signer(
          signer,
          signer.signerType === 'email'
            ? (deliveryBySigner.get(signer.id) ?? null)
            : null,
          codeBySigner.get(signer.id),
        ),
      ),
      fields: fields.map((field) => this.mapper.field(field)),
    };
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
    const documentEvents = new Set([
      'document.created',
      'document.initiated',
      'document.completed',
      'document.stopped_by_creator',
      'document.stopped_by_deadline',
      'document.expired',
    ]);
    return events
      .filter(
        (event) =>
          isCreator ||
          documentEvents.has(event.eventType) ||
          event.signerId === signer?.id,
      )
      .map((event) => ({
        type: event.eventType,
        occurredAt: event.occurredAt.toISOString(),
        actor: isCreator
          ? event.actorUserId === userId
            ? '建立人'
            : '系統'
          : event.signerId === signer?.id
            ? '本人'
            : '系統',
        reason:
          typeof event.metadataJson?.reason === 'string'
            ? event.metadataJson.reason
            : null,
      }));
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
