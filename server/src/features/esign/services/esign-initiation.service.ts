import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppException } from '#app/common/errors/app.exception';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { readPrivateFile } from '#app/infrastructure/file-storage/read-private-file';
import { DocumentFieldRepository } from '../repositories/document-field.repository';
import { DocumentRepository } from '../repositories/document.repository';
import { FileObjectRepository } from '../repositories/file-object.repository';
import { NotificationRepository } from '../repositories/notification.repository';
import { SignerRepository } from '../repositories/signer.repository';
import { canonicalJson, EsignAuditService } from './esign-audit.service';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignConsentService } from './esign-consent.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { EsignJobProducerService } from './esign-job-producer.service';
import { EsignTokenService } from './esign-token.service';
import { PdfValidationService } from './pdf-validation.service';
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
}

@Injectable()
export class EsignInitiationService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly documents: DocumentRepository,
    private readonly signers: SignerRepository,
    private readonly fields: DocumentFieldRepository,
    private readonly files: FileObjectRepository,
    private readonly notifications: NotificationRepository,
    private readonly access: EsignAccessPolicyService,
    private readonly validation: EsignDocumentValidationService,
    private readonly pdf: PdfValidationService,
    private readonly consent: EsignConsentService,
    private readonly tokens: EsignTokenService,
    private readonly audit: EsignAuditService,
    private readonly jobs: EsignJobProducerService,
    @Inject(PRIVATE_FILE_STORAGE)
    private readonly storage: PrivateFileStorage,
    private readonly signerService: EsignSignerService,
    private readonly fieldService: EsignFieldService,
  ) {}

  async initiate(input: InitiateDocumentInput) {
    if (
      !Number.isFinite(input.signStartAt.getTime()) ||
      !Number.isFinite(input.signEndAt.getTime()) ||
      input.signStartAt >= input.signEndAt
    ) {
      throw this.invalid('簽署開始時間必須早於截止時間');
    }

    const result = await this.mysql.transaction(async (manager) => {
      const document = await this.documents.findByIdForUpdate(
        input.documentId,
        manager,
      );
      this.access.checkEsignCreator(document, input.creatorUserId);
      this.validation.checkStillDraft(document);

      const replacements = await this.signerService.replaceInTransaction(
        input.documentId,
        input.creatorUserId,
        input.signers,
        manager,
      );
      const fieldInputs = input.fields.map(({ signerIndex, ...field }) => {
        const signer =
          Number.isInteger(signerIndex) && signerIndex >= 0
            ? replacements[signerIndex]
            : undefined;
        if (!signer) throw this.invalid('欄位指定的簽署人不在本次名單中');
        return { ...field, signerPublicId: signer.publicId };
      });
      await this.fieldService.replaceInTransaction(
        input.documentId,
        input.creatorUserId,
        fieldInputs,
        manager,
      );

      const [signers, fields, source] = await Promise.all([
        this.signers.findByDocumentForUpdate(input.documentId, manager),
        this.fields.findByDocumentForUpdate(input.documentId, manager),
        this.files.findDocumentFile(input.documentId, 'source_pdf', manager),
      ]);
      if (!source) throw this.invalid('草稿缺少 PDF 文件');
      if (signers.length < 1 || signers.length > 50) {
        throw this.invalid('文件必須有 1 至 50 名簽署人');
      }
      if (fields.length > 200) throw this.invalid('欄位數量不可超過 200 個');

      const sourceBytes = await readPrivateFile(this.storage, source);
      const sourceMetadata = await this.pdf.validatePersistedPdf(sourceBytes);
      this.validation.assertSourceIntegrity(
        document,
        source,
        sourceMetadata.sha256,
      );

      const signerIds = new Set(signers.map((signer) => signer.id));
      if (
        fields.some(
          (field) =>
            field.signerId === undefined ||
            !signerIds.has(field.signerId) ||
            field.documentId !== document.id ||
            field.pageNumber > sourceMetadata.pageCount,
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
          allowReject: false,
          watermark: false,
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
      const initiatedAt = new Date();

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

      document.status = 'active';
      document.signStartAt = input.signStartAt;
      document.signEndAt = input.signEndAt;
      document.signingPayloadJson = payload;
      document.signingPayloadSha256 = payloadSha256;
      document.initiatedAt = initiatedAt;
      document.watermarkEnabled = false;
      document.allowReject = false;
      await this.documents.save(document, manager);

      const notificationLogIds: number[] = [];
      if (externalSigners.length > 0) {
        const batch = await this.notifications.saveBatch(
          this.notifications.createBatch(
            {
              documentId: document.id,
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
          metadata: { status: 'active', consentVersion: activeConsent.version },
        },
        manager,
      );
      return { document, notificationLogIds };
    });

    await this.jobs.enqueueInvitations(result.notificationLogIds);
    return result.document;
  }

  private invalid(message: string): AppException {
    return new AppException(
      AppErrorCode.INVALID_REQUEST,
      message,
      HttpStatus.BAD_REQUEST,
    );
  }
}
