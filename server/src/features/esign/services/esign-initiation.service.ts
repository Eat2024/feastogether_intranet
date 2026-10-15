import type { EntityManager } from 'typeorm';
import type { EsignDocument } from '../entities/esign-document.entity';
import type { EsignSigner } from '../entities/esign-signer.entity';
import type { EsignDocumentField } from '../entities/esign-document-field.entity';
import type { FieldInputDto } from '../dto/field.dto';
import type { ValidatedPdf } from './pdf-validation.service';
import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppException } from '#app/common/errors/app.exception';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { DocumentRepository } from '../repositories/document.repository';
import { NotificationRepository } from '../repositories/notification.repository';
import { SignerRepository } from '../repositories/signer.repository';
import { canonicalJson, EsignAuditService } from './esign-audit.service';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignConsentService } from './esign-consent.service';
import { EsignJobProducerService } from './esign-job-producer.service';
import { EsignTokenService } from './esign-token.service';
import { EsignSignerService } from './esign-signer.service';
import { EsignFieldService } from './esign-field.service';
import type { SignerInputDto } from '../dto/signer.dto';
import type { InitiationFieldDto } from '../dto/initiation.dto';

export interface InitiateDocumentInput {
  signers: SignerInputDto[];
  fields: InitiationFieldDto[];
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
  ) { }

  async initiate(input: InitiateDocumentInput) {
    this.validateSigningPeriod(input);
    const result = await this.mysql.transaction(async (manager) => {
      const document = await this.access.checkAndLockDraftDoc(
        input.documentId,
        input.creatorUserId,
        manager,
      );
      const signers = await this.signerService.updateSigners(
        document,
        input.creatorUserId,
        input.signers,
        manager,
      );
      const fieldInputs = this.mapFieldsToSigners(input.fields, signers);
      const { fields, sourceMetadata } = await this.fieldService.buildFields(
        document,
        input.creatorUserId,
        fieldInputs,
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
      const externalSigners = await this.createExternalInvitationTokens(
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
        externalSigners,
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

  private validateSigningPeriod(input: InitiateDocumentInput): void {
    if (
      !Number.isFinite(input.signStartAt.getTime()) ||
      !Number.isFinite(input.signEndAt.getTime()) ||
      input.signStartAt >= input.signEndAt
    ) {
      throw this.invalid('簽署開始時間必須早於截止時間');
    }
  }

  private mapFieldsToSigners(
    fields: InitiationFieldDto[],
    signers: EsignSigner[],
  ): FieldInputDto[] {
    return fields.map(({ signerIndex, ...field }) => {
      const signer =
        Number.isInteger(signerIndex) && signerIndex >= 0
          ? signers[signerIndex]
          : undefined;
      if (!signer) throw this.invalid('欄位指定的簽署人不在本次名單中');
      return { ...field, signerPublicId: signer.publicId };
    });
  }

  private validateSigningAssignments(
    document: EsignDocument,
    signers: EsignSigner[],
    fields: EsignDocumentField[],
    pageCount: number,
  ): void {
    if (signers.length < 1 || signers.length > 50) {
      throw this.invalid('文件必須有 1 至 50 名簽署人');
    }
    if (fields.length > 200) throw this.invalid('欄位數量不可超過 200 個');

    const signerIds = new Set(signers.map((signer) => signer.id));
    if (
      fields.some(
        (field) =>
          field.signerId === undefined ||
          !signerIds.has(field.signerId) ||
          field.documentId !== document.id ||
          field.pageNumber > pageCount,
      )
    ) {
      throw this.invalid('文件包含無效或未指派的簽署欄位');
    }
    for (const signer of signers) {
      if (
        !fields.some(
          (field) =>
            field.signerId === signer.id && field.fieldType === 'signature',
        )
      ) {
        throw this.invalid('每名簽署人至少需要一個簽名欄位');
      }
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
        signerId: String(field.signerId),
        type: field.fieldType,
        page: field.pageNumber,
        xPercent: Number(field.xPercent),
        yPercent: Number(field.yPercent),
        widthPercent: Number(field.widthPercent),
        heightPercent: Number(field.heightPercent),
        sortOrder: field.sortOrder,
      })),
    };
    const payloadJson = canonicalJson(payload);
    const payloadSha256 = createHash('sha256')
      .update(payloadJson, 'utf8')
      .digest('hex');
    return { payload, payloadSha256, consentVersion: activeConsent.version };
  }

  private async createExternalInvitationTokens(
    input: InitiateDocumentInput,
    signers: EsignSigner[],
    manager: EntityManager,
  ): Promise<EsignSigner[]> {
    const externalSigners = signers.filter(
      (signer) => signer.signerType === 'email',
    );
    for (const signer of externalSigners) {
      const token = this.tokens.createInvitationToken();
      signer.invitationTokenSha256 = token.digest;
      signer.invitationTokenCiphertext = token.ciphertext;
      signer.invitationExpiresAt = input.signEndAt;
      signer.updatedByUserId = input.creatorUserId;
    }
    if (externalSigners.length > 0) {
      await this.signers.saveMany(externalSigners, manager);
    }
    return externalSigners;
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
    externalSigners: EsignSigner[],
    initiatedAt: Date,
    manager: EntityManager,
  ): Promise<number[]> {
    const notificationLogIds: number[] = [];
    if (externalSigners.length > 0) {
      const batch = await this.notifications.saveBatch(
        this.notifications.createBatch(
          {
            documentId: documentId,
            filterType: 'external_invitation',
            targetCount: externalSigners.length,
            notifiedByUserId: input.creatorUserId,
          },
          manager,
        ),
        manager,
      );
      const logs = await this.notifications.saveLogs(
        externalSigners.map((signer) =>
          this.notifications.createLog(
            {
              batchId: batch.id,
              signerId: signer.id,
              channel: 'email',
              result: 'pending',
              attemptCount: 0,
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

  private invalid(message: string): AppException {
    return new AppException(
      AppErrorCode.INVALID_REQUEST,
      message,
      HttpStatus.BAD_REQUEST,
    );
  }
}
