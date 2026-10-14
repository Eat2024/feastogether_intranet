import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppException } from '#app/common/errors/app.exception';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
  type StoredPrivateFile,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { readPrivateFile } from '#app/infrastructure/file-storage/read-private-file';
import type { SignatureSubmissionDto } from '../dto/signature-submission.dto';
import { DocumentFieldRepository } from '../repositories/document-field.repository';
import { DocumentRepository } from '../repositories/document.repository';
import { FileObjectRepository } from '../repositories/file-object.repository';
import { SignatureRecordRepository } from '../repositories/signature-record.repository';
import { SignerRepository } from '../repositories/signer.repository';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { canonicalJson, EsignAuditService } from './esign-audit.service';
import { EsignConsentService } from './esign-consent.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { EsignJobProducerService } from './esign-job-producer.service';
import { EsignTokenService } from './esign-token.service';
import { PdfValidationService } from './pdf-validation.service';

export type SigningPrincipal =
  | { kind: 'internal'; userId: number }
  | { kind: 'external'; invitationDigest: string };

export interface SigningRequestContext {
  sourceIp?: string;
  userAgent?: string;
}

@Injectable()
export class EsignSigningService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly documents: DocumentRepository,
    private readonly signers: SignerRepository,
    private readonly fields: DocumentFieldRepository,
    private readonly files: FileObjectRepository,
    private readonly records: SignatureRecordRepository,
    private readonly access: EsignAccessPolicyService,
    private readonly validation: EsignDocumentValidationService,
    private readonly pdf: PdfValidationService,
    private readonly consent: EsignConsentService,
    private readonly tokens: EsignTokenService,
    private readonly audit: EsignAuditService,
    private readonly jobs: EsignJobProducerService,
    @Inject(PRIVATE_FILE_STORAGE)
    private readonly storage: PrivateFileStorage,
  ) {}

  async sign(
    signerPublicId: string,
    principal: SigningPrincipal,
    submission: SignatureSubmissionDto,
    request: SigningRequestContext,
  ) {
    this.consent.assertAccepted(submission.consentVersion, submission.accepted);
    const manager = this.mysql.getManager();
    const signer = await this.signers.findByPublicId(signerPublicId, manager);
    const document = signer
      ? await this.documents.findById(signer.documentId, manager)
      : null;
    const authenticationEventId = `${principal.kind}:${signerPublicId}:${submission.requestId}`;
    const repeated = await this.records.findByAuthenticationEventId(
      authenticationEventId,
      manager,
    );
    if (repeated && signer && repeated.signerId === signer.id && document) {
      if (principal.kind === 'internal') {
        this.access.assertInternalSigner(document, signer, principal.userId);
      } else {
        this.access.assertExternalCredential(
          document,
          signer,
          principal.invitationDigest,
        );
      }
      return {
        signerPublicId,
        signedAt: repeated.signedAtUtc,
        documentStatus: document.status,
        repeated: true,
      };
    }
    this.assertPrincipal(document, signer, principal, new Date());
    if (!signer || !document) throw new Error('unreachable');
    const fields = await this.fields.findByDocument(document.id, manager);
    const ownFields = fields.filter((field) => field.signerId === signer.id);
    const signatureFields = ownFields.filter(
      (field) => field.fieldType === 'signature',
    );
    this.validation.assertFieldsBelongToSigner(ownFields, signer);
    const inputByField = this.validateSignatureInputs(
      signatureFields.map((field) => field.id),
      submission,
    );

    const stored: Array<{ fieldId: number; file: StoredPrivateFile }> = [];
    try {
      for (const field of signatureFields) {
        const signatureBytes = inputByField.get(field.id)!;
        await this.assertDecodablePng(signatureBytes);
        stored.push({
          fieldId: field.id,
          file: await this.storage.store({
            directory: `documents/${document.docNumber}/signatures/${signer.publicId}/${field.id}`,
            extension: 'png',
            mimeType: 'image/png',
            bytes: signatureBytes,
          }),
        });
      }

      const result = await this.mysql.transaction(async (tx) => {
        // 所有 document/signer 競態統一先鎖 document，避免與停止流程反向鎖定造成 deadlock。
        const lockedDocument = await this.documents.findByIdForUpdate(
          document.id,
          tx,
        );
        const lockedSigner = await this.signers.findByPublicIdForUpdate(
          signerPublicId,
          tx,
        );
        const repeated = await this.records.findByAuthenticationEventId(
          authenticationEventId,
          tx,
        );
        if (repeated && lockedSigner && repeated.signerId === lockedSigner.id) {
          return {
            signerPublicId,
            signedAt: repeated.signedAtUtc,
            documentStatus: lockedDocument?.status ?? 'active',
            repeated: true,
          };
        }
        this.assertPrincipal(
          lockedDocument,
          lockedSigner,
          principal,
          new Date(),
        );
        if (!lockedSigner || !lockedDocument) throw new Error('unreachable');
        this.validation.assertPendingSigner(lockedSigner, lockedDocument.id);
        const existing = await this.records.findBySignerId(lockedSigner.id, tx);
        if (existing) throw this.conflict('此簽署任務已完成');

        const [lockedFields, source] = await Promise.all([
          this.fields.findByDocumentForUpdate(lockedDocument.id, tx),
          this.files.findDocumentFile(lockedDocument.id, 'source_pdf', tx),
        ]);
        if (!source) throw this.integrity();
        const persistedPdf = await this.pdf.validatePersistedPdf(
          await readPrivateFile(this.storage, source),
        );
        this.validation.assertSourceIntegrity(
          lockedDocument,
          source,
          persistedPdf.sha256,
        );
        const payloadHash = createHash('sha256')
          .update(canonicalJson(lockedDocument.signingPayloadJson), 'utf8')
          .digest('hex');
        this.validation.assertPayloadIntegrity(lockedDocument, payloadHash);
        const lockedOwnFields = lockedFields.filter(
          (field) => field.signerId === lockedSigner.id,
        );
        this.validation.assertFieldsBelongToSigner(
          lockedOwnFields,
          lockedSigner,
        );
        this.validateSignatureInputs(
          lockedOwnFields
            .filter((field) => field.fieldType === 'signature')
            .map((field) => field.id),
          submission,
        );

        const signedAt = new Date();
        const inserted = await this.records.insert(
          {
            signerId: lockedSigner.id,
            documentSha256: persistedPdf.sha256,
            signingPayloadSha256: payloadHash,
            consentVersion: submission.consentVersion,
            authenticationMethod:
              principal.kind === 'internal'
                ? 'employee_session'
                : 'email_invitation',
            authenticationEventId,
            sourceIp: request.sourceIp?.slice(0, 45),
            userAgent: request.userAgent?.slice(0, 500),
            signedAtUtc: signedAt,
          },
          tx,
        );
        const recordId = Number(inserted.identifiers[0]?.id);
        if (!Number.isSafeInteger(recordId)) throw this.integrity();
        await this.files.insertMany(
          stored.map(({ fieldId, file }) => ({
            signatureRecordId: recordId,
            documentFieldId: fieldId,
            filePurpose: 'signature_png',
            objectKey: file.objectKey,
            objectVersion: file.objectVersion,
            mimeType: file.mimeType,
            fileSize: file.fileSize,
            sha256: file.sha256,
            archiveStatus: 'active',
          })),
          tx,
        );
        lockedSigner.status = 'signed';
        lockedSigner.signedAt = signedAt;
        lockedSigner.invitationTokenCiphertext = undefined;
        lockedSigner.invitationExpiresAt = undefined;
        let receiptToken: string | undefined;
        if (lockedSigner.signerType === 'email') {
          const receipt = this.tokens.createReceiptToken();
          receiptToken = receipt.token;
          lockedSigner.completionReceiptSha256 = receipt.digest;
        }
        await this.signers.save(lockedSigner, tx);
        const auditBase = {
          documentId: lockedDocument.id,
          signerId: lockedSigner.id,
          actorUserId:
            principal.kind === 'internal' ? principal.userId : undefined,
          occurredAt: signedAt,
          requestId: submission.requestId,
        };
        await this.audit.append(
          {
            ...auditBase,
            eventType: 'consent.accepted',
            metadata: { consentVersion: submission.consentVersion },
          },
          tx,
        );
        await this.audit.append(
          {
            ...auditBase,
            eventType: 'signature.submitted',
          },
          tx,
        );
        await this.audit.append(
          {
            ...auditBase,
            eventType: 'signature.completed',
            metadata: { status: 'signed' },
          },
          tx,
        );
        const allSigners = await this.signers.findByDocumentForUpdate(
          lockedDocument.id,
          tx,
        );
        return {
          signerPublicId,
          signedAt,
          documentStatus: lockedDocument.status,
          documentId: lockedDocument.id,
          allSigned: allSigners.every((item) => item.status === 'signed'),
          receiptToken,
          repeated: false,
        };
      });

      if (result.repeated) {
        await this.deleteStored(stored);
      } else if (result.allSigned && result.documentId) {
        await this.jobs.enqueueFinalization(result.documentId);
      }
      return result;
    } catch (error) {
      await this.deleteStored(stored);
      throw error;
    }
  }

  private assertPrincipal(
    document: Parameters<EsignAccessPolicyService['checkEsignCreator']>[0],
    signer: Awaited<ReturnType<SignerRepository['findByPublicId']>>,
    principal: SigningPrincipal,
    now: Date,
  ): void {
    if (!signer || !document) {
      if (principal.kind === 'external') {
        throw new AppException(
          AppErrorCode.ESIGN_EXTERNAL_UNAUTHORIZED,
          '外部簽署存取已失效',
          HttpStatus.UNAUTHORIZED,
        );
      }
      this.access.checkEsignCreator(null, principal.userId);
      return;
    }
    if (principal.kind === 'internal') {
      this.access.assertInternalSigner(document, signer, principal.userId);
      this.validation.assertActiveSigningWindow(document, now);
    } else {
      this.access.assertExternalInvitation(
        document,
        signer,
        principal.invitationDigest,
        now,
      );
    }
  }

  private validateSignatureInputs(
    requiredFieldIds: number[],
    submission: SignatureSubmissionDto,
  ): Map<number, Buffer> {
    const required = new Set(requiredFieldIds);
    const result = new Map<number, Buffer>();
    for (const input of submission.signatures) {
      const fieldId = Number(input.fieldId);
      if (!required.has(fieldId) || result.has(fieldId)) {
        throw this.invalid('簽名欄位不完整或不屬於目前簽署人');
      }
      const encoded = input.pngDataUrl.slice('data:image/png;base64,'.length);
      const bytes = Buffer.from(encoded, 'base64');
      if (
        encoded.length === 0 ||
        bytes.toString('base64') !== encoded ||
        !bytes
          .subarray(0, 8)
          .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      ) {
        throw this.invalid('簽名必須是有效 PNG 圖片');
      }
      result.set(fieldId, bytes);
    }
    if (result.size !== required.size) {
      throw this.invalid('請完成所有必要簽名欄位');
    }
    return result;
  }

  private async deleteStored(
    stored: Array<{ file: StoredPrivateFile }>,
  ): Promise<void> {
    await Promise.all(
      stored.map(({ file }) =>
        this.storage.delete(file).catch(() => undefined),
      ),
    );
  }

  private async assertDecodablePng(bytes: Uint8Array): Promise<void> {
    try {
      const probe = await PDFDocument.create();
      await probe.embedPng(bytes);
    } catch {
      throw this.invalid('簽名必須是有效 PNG 圖片');
    }
  }

  private invalid(message: string): AppException {
    return new AppException(
      AppErrorCode.INVALID_REQUEST,
      message,
      HttpStatus.BAD_REQUEST,
    );
  }

  private conflict(message: string): AppException {
    return new AppException(
      AppErrorCode.ESIGN_STATE_CONFLICT,
      message,
      HttpStatus.CONFLICT,
    );
  }

  private integrity(): AppException {
    return new AppException(
      AppErrorCode.ESIGN_INTEGRITY_FAILED,
      '文件完整性驗證失敗',
      HttpStatus.CONFLICT,
    );
  }
}
