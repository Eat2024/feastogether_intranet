import { AppErrors } from '#app/common/errors/app-errors';
import type { EntityManager } from 'typeorm';
import type { EsignDocument } from '../entities/esign-document.entity';
import type { EsignSigner } from '../entities/esign-signer.entity';
import type { EsignDocumentField } from '../entities/esign-document-field.entity';
import type { ValidatedPdf } from './pdf-validation.service';
import { Injectable } from '@nestjs/common';
import { AppException } from '#app/common/errors/app.exception';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { DocumentRepository } from '../repositories/document.repository';
import { NotificationRepository } from '../repositories/notification.repository';
import { SignerRepository } from '../repositories/signer.repository';
import { canonicalSha256, EsignAuditService } from './esign-audit.service';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignConsentService } from './esign-consent.service';
import { EsignJobProducerService } from './esign-job-producer.service';
import { EsignTokenService } from './esign-token.service';
import { EsignSignerService } from './esign-signer.service';
import { EsignFieldService } from './esign-field.service';
import type { SignerInputDto } from '../dto/signer.dto';
import type { FieldPlacementDto } from '../dto/field.dto';
import {
  EsignEmployeeEmailService,
  type EmployeeEmailResult,
} from './esign-employee-email.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';

export interface InitiateDocumentInput {
  signers: SignerInputDto[];
  fields: FieldPlacementDto[];
  documentId: number;
  creatorUserId: number;
  signStartAt: Date;
  signEndAt: Date;
  /** 下載／匯出的已簽署 PDF 是否加上浮水印 */
  watermark: boolean;
  /** 是否允許簽署人拒絕簽署 */
  allowReject: boolean;
}

interface SigningSnapshot {
  payload: Record<string, unknown>;
  payloadSha256: string;
  consentVersion: string;
}

@Injectable()
export class EsignInitiationService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly documents: DocumentRepository,
    private readonly signers: SignerRepository,
    private readonly notifications: NotificationRepository,
    private readonly access: EsignAccessPolicyService,
    private readonly consent: EsignConsentService,
    private readonly tokens: EsignTokenService,
    private readonly audit: EsignAuditService,
    private readonly jobs: EsignJobProducerService,
    private readonly signerService: EsignSignerService,
    private readonly fieldService: EsignFieldService,
    private readonly employeeEmails: EsignEmployeeEmailService,
    private readonly validation: EsignDocumentValidationService,
  ) {}

  async initiate(input: InitiateDocumentInput) {
    this.validateSigningPeriod(input);
    const emails = await this.prepareEmployeeEmails(input);
    const result = await this.mysql.transaction(async (manager) => {
      const document = await this.access.checkAndLockDraftDoc(
        input.documentId,
        input.creatorUserId,
        manager,
      );
      if (emails.length) {
        try {
          const current = await this.employeeEmails.resolveUsers(
            emails.map((item) => String(item.userId)),
            manager,
          );
          const original = new Map(
            emails.map((item) => [item.userId, item.empid]),
          );
          if (current.some((item) => original.get(item.userId) !== item.empid))
            throw new AppException(
              ...AppErrors.ESIGN_EMPLOYEE_IDENTITY_CHANGED,
            );
        } catch (error) {
          if (
            error instanceof AppException &&
            error.code === 'ESIGN_EMPLOYEE_IDENTITY_UNAVAILABLE'
          )
            throw new AppException(
              ...AppErrors.ESIGN_EMPLOYEE_IDENTITY_CHANGED,
            );
          throw error;
        }
      }
      const signers = await this.signerService.updateSigners(
        document,
        input.creatorUserId,
        input.signers,
        manager,
      );
      const emailByUser = new Map(emails.map((item) => [item.userId, item]));
      for (const signer of signers) {
        if (signer.signerType !== 'user') continue;
        const fixed = signer.userId
          ? emailByUser.get(signer.userId)
          : undefined;
        if (!fixed || fixed.empid !== signer.empidSnapshot)
          throw new AppException(...AppErrors.ESIGN_EMPLOYEE_IDENTITY_CHANGED);
        signer.email = fixed.email!;
      }
      const { fields, sourceMetadata } = await this.fieldService.buildFields(
        document,
        input.creatorUserId,
        input.fields,
        manager,
      );
      this.validateSigningAssignments(
        document,
        signers,
        fields,
        sourceMetadata.pageCount,
      );
      const snapshot = this.buildSigningSnapshot(
        input,
        document,
        signers,
        fields,
        sourceMetadata,
      );
      const initiatedAt = new Date();
      const invitationSigners = await this.createInvitationTokens(
        input,
        signers,
        manager,
      );
      await this.activateDocument(
        input,
        document,
        snapshot,
        initiatedAt,
        manager,
      );
      const notificationLogIds = await this.createInvitationNotifications(
        input,
        document.id,
        invitationSigners,
        initiatedAt,
        manager,
      );
      await this.recordInitiationAudit(
        input,
        document,
        signers,
        snapshot.consentVersion,
        initiatedAt,
        manager,
      );
      return { document, notificationLogIds };
    });

    // 通知工作須在交易提交後才入列。
    await this.jobs.enqueueInvitations(result.notificationLogIds);
    return result.document;
  }

  private async prepareEmployeeEmails(
    input: InitiateDocumentInput,
  ): Promise<EmployeeEmailResult[]> {
    const document = await this.documents.findById(
      input.documentId,
      this.mysql.getManager(),
    );
    this.access.checkEsignCreator(document, input.creatorUserId);
    this.validation.checkStillDraft(document);
    const userIds = input.signers
      .filter((signer) => signer.type === 'user')
      .map((signer) => signer.userId!);
    if (!userIds.length) return [];
    const identities = await this.employeeEmails.resolveUsers(userIds);
    const emails = await this.employeeEmails.lookupEmails(identities);
    const unavailable = emails
      .filter((item) => !item.email)
      .map((item) => String(item.userId));
    if (unavailable.length)
      throw new AppException(...AppErrors.ESIGN_EMPLOYEE_EMAIL_UNAVAILABLE, {
        userIds: unavailable,
      });
    return emails;
  }

  private validateSigningPeriod(input: InitiateDocumentInput): void {
    if (
      !Number.isFinite(input.signStartAt.getTime()) ||
      !Number.isFinite(input.signEndAt.getTime()) ||
      input.signStartAt >= input.signEndAt
    ) {
      throw new AppException(...AppErrors.ESIGN_SIGNING_PERIOD_INVALID);
    }
  }

  private validateSigningAssignments(
    document: EsignDocument,
    signers: EsignSigner[],
    fields: EsignDocumentField[],
    pageCount: number,
  ): void {
    if (signers.length < 1) {
      throw new AppException(...AppErrors.ESIGN_DOCUMENT_SIGNER_REQUIRED);
    }
    if (fields.length > 200)
      throw new AppException(...AppErrors.ESIGN_FIELD_LIMIT_EXCEEDED);

    if (
      fields.some(
        (field) =>
          field.documentId !== document.id || field.pageNumber > pageCount,
      )
    ) {
      throw new AppException(...AppErrors.ESIGN_FIELDS_INVALID);
    }
    if (!fields.some((field) => field.fieldType === 'signature')) {
      throw new AppException(...AppErrors.ESIGN_SHARED_SIGNATURE_REQUIRED);
    }
  }

  private buildSigningSnapshot(
    input: InitiateDocumentInput,
    document: EsignDocument,
    signers: EsignSigner[],
    fields: EsignDocumentField[],
    sourceMetadata: ValidatedPdf,
  ): SigningSnapshot {
    const activeConsent = this.consent.getActive();
    const payload = {
      schemaVersion: 2,
      document: {
        id: String(document.id),
        docNumber: document.docNumber,
        title: document.title,
        sourceFileSha256: sourceMetadata.sha256,
      },
      period: {
        startAt: input.signStartAt.toISOString(),
        endAt: input.signEndAt.toISOString(),
      },
      consent: {
        version: activeConsent.version,
        sha256: activeConsent.sha256,
      },
      options: {
        parallelSigning: true,
        allowReject: input.allowReject,
        watermark: input.watermark,
      },
      signers: signers.map((signer) => ({
        id: String(signer.id),
        publicId: signer.publicId,
        type: signer.signerType,
        userId: signer.userId ? String(signer.userId) : null,
        email: signer.email ?? null,
        employeeNo: signer.empidSnapshot ?? null,
        name: signer.nameSnapshot,
        department: signer.departmentSnapshot ?? null,
        title: signer.titleSnapshot ?? null,
        sortOrder: signer.sortOrder,
      })),
      fields: fields.map((field) => ({
        id: String(field.id),
        type: field.fieldType,
        page: field.pageNumber,
        xPercent: Number(field.xPercent),
        yPercent: Number(field.yPercent),
        widthPercent: Number(field.widthPercent),
        heightPercent: Number(field.heightPercent),
        sortOrder: field.sortOrder,
      })),
    };
    const payloadSha256 = canonicalSha256(payload);
    return { payload, payloadSha256, consentVersion: activeConsent.version };
  }

  private async createInvitationTokens(
    input: InitiateDocumentInput,
    signers: EsignSigner[],
    manager: EntityManager,
  ): Promise<EsignSigner[]> {
    const invitationSigners = signers;
    for (const signer of invitationSigners) {
      const token = this.tokens.createInvitationToken();
      signer.invitationTokenSha256 = token.digest;
      signer.invitationTokenCiphertext = token.ciphertext;
      signer.invitationExpiresAt = input.signEndAt;
      signer.updatedByUserId = input.creatorUserId;
    }
    if (invitationSigners.length > 0) {
      await this.signers.saveMany(invitationSigners, manager);
    }
    return invitationSigners;
  }

  private async activateDocument(
    input: InitiateDocumentInput,
    document: EsignDocument,
    snapshot: SigningSnapshot,
    initiatedAt: Date,
    manager: EntityManager,
  ): Promise<void> {
    document.status = 'active';
    document.signStartAt = input.signStartAt;
    document.signEndAt = input.signEndAt;
    document.signingPayloadJson = snapshot.payload;
    document.signingPayloadSha256 = snapshot.payloadSha256;
    document.initiatedAt = initiatedAt;
    document.watermarkEnabled = input.watermark;
    document.allowReject = input.allowReject;
    await this.documents.save(document, manager);
  }

  private async createInvitationNotifications(
    input: InitiateDocumentInput,
    documentId: number,
    invitationSigners: EsignSigner[],
    initiatedAt: Date,
    manager: EntityManager,
  ): Promise<number[]> {
    const notificationLogIds: number[] = [];
    if (invitationSigners.length > 0) {
      const batch = await this.notifications.saveBatch(
        this.notifications.createBatch(
          {
            documentId: documentId,
            filterType: 'external_invitation',
            targetCount: invitationSigners.length,
            notifiedByUserId: input.creatorUserId,
          },
          manager,
        ),
        manager,
      );
      const logs = await this.notifications.saveLogs(
        invitationSigners.map((signer) =>
          this.notifications.createLog(
            {
              batchId: batch.id,
              signerId: signer.id,
              channel: 'email',
              result: 'pending',
              attemptCount: 0,
              invitationGenerationSha256: signer.invitationTokenSha256,
              nextAttemptAt: initiatedAt,
            },
            manager,
          ),
        ),
        manager,
      );
      notificationLogIds.push(...logs.map((log) => log.id));
    }

    return notificationLogIds;
  }

  private async recordInitiationAudit(
    input: InitiateDocumentInput,
    document: EsignDocument,
    signers: EsignSigner[],
    consentVersion: string,
    initiatedAt: Date,
    manager: EntityManager,
  ): Promise<void> {
    for (const signer of signers) {
      await this.audit.append(
        {
          documentId: document.id,
          signerId: signer.id,
          actorUserId: input.creatorUserId,
          eventType: 'signer.assigned',
          occurredAt: initiatedAt,
          metadata: { status: 'pending' },
        },
        manager,
      );
    }
    await this.audit.append(
      {
        documentId: document.id,
        actorUserId: input.creatorUserId,
        eventType: 'document.initiated',
        occurredAt: initiatedAt,
        metadata: { status: 'active', consentVersion: consentVersion },
      },
      manager,
    );
  }
}
