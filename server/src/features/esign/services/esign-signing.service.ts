import { AppErrors } from '#app/common/errors/app-errors';
import { Inject, Injectable } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
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
import { canonicalSha256, EsignAuditService } from './esign-audit.service';
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

/** 簽署結果的公開欄位；明確裁切，避免內部識別與憑證外洩。 */
export function toSignatureResultView(
  result: Awaited<ReturnType<EsignSigningService['sign']>>,
) {
  return {
    signerPublicId: result.signerPublicId,
    signedAt: result.signedAt.toISOString(),
    documentStatus: result.documentStatus,
    verificationUrl: result.verificationUrl,
    completion: result.completion,
  };
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

  /** 簽署成功（含重送）後才附上該簽章的驗證網址；失敗路徑一律拋錯，不會發出網址。 */
  async sign(
    signerPublicId: string,
    principal: SigningPrincipal,
    submission: SignatureSubmissionDto,
    request: SigningRequestContext,
  ) {
    const result = await this.submit(
      signerPublicId,
      principal,
      submission,
      request,
    );
    return {
      ...result,
      verificationUrl: this.tokens.verificationUrl(result.verificationCode),
    };
  }

  private async submit(
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
        this.access.assertExternalInvitation(
          document,
          signer,
          principal.invitationDigest,
          new Date(),
        );
      }
      return {
        signerPublicId,
        signedAt: repeated.signedAtUtc,
        documentStatus: document.status,
        verificationCode: repeated.verificationCode,
        completion: {
          status: signer.completionStatus,
          readyAt: signer.completionReadyAt?.toISOString() ?? null,
        },
        repeated: true,
      };
    }
    this.assertPrincipal(document, signer, principal, new Date());
    if (!signer || !document) throw new Error('unreachable');
    const fields = await this.fields.findByDocument(document.id, manager);
    const signatureFields = fields.filter(
      (field) => field.fieldType === 'signature',
    );
    this.validation.assertFieldsBelongToDocument(fields, signer.documentId);
    const inputByField = this.validateSignatureInputs(
      signatureFields.map((field) => field.id),
      submission,
    );

    const stored: Array<{ fieldId: number; file: StoredPrivateFile }> = [];
    let committed = false;
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
        if (
          repeated &&
          lockedDocument &&
          lockedSigner &&
          repeated.signerId === lockedSigner.id
        ) {
          if (principal.kind === 'internal') {
            this.access.assertInternalSigner(
              lockedDocument,
              lockedSigner,
              principal.userId,
            );
          } else {
            this.access.assertExternalInvitation(
              lockedDocument,
              lockedSigner,
              principal.invitationDigest,
              new Date(),
            );
          }
          return {
            signerPublicId,
            signedAt: repeated.signedAtUtc,
            documentStatus: lockedDocument?.status ?? 'active',
            verificationCode: repeated.verificationCode,
            completion: {
              status: lockedSigner.completionStatus,
              readyAt: lockedSigner.completionReadyAt?.toISOString() ?? null,
            },
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
        if (existing)
          throw new AppException(...AppErrors.ESIGN_SIGNING_TASK_COMPLETED);

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
        const payloadHash = canonicalSha256(lockedDocument.signingPayloadJson);
        this.validation.assertPayloadIntegrity(lockedDocument, payloadHash);
        this.validation.assertFieldsBelongToDocument(
          lockedFields,
          lockedSigner.documentId,
        );
        this.validation.assertSigningSnapshot(
          lockedDocument,
          persistedPdf.sha256,
          lockedFields,
        );
        this.validateSignatureInputs(
          lockedFields
            .filter((field) => field.fieldType === 'signature')
            .map((field) => field.id),
          submission,
        );

        const signedAt = new Date();
        this.validation.assertActiveSigningWindow(lockedDocument, signedAt);
        const verificationCode = this.tokens.createVerificationCode();
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
            verificationCode,
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
        lockedSigner.invitationTokenCiphertext = null;
        lockedSigner.invitationExpiresAt = null;
        lockedSigner.completionStatus = 'pending';
        lockedSigner.completionLeaseToken = null;
        lockedSigner.completionLeaseExpiresAt = null;
        lockedSigner.completionReadyAt = null;
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
        const counts = await this.signers.completionCounts(
          lockedDocument.id,
          tx,
        );
        if (counts.total > 0 && counts.pending === 0) {
          lockedDocument.status = 'finalizing';
          await this.documents.save(lockedDocument, tx);
        }
        return {
          signerPublicId,
          signedAt,
          documentStatus: lockedDocument.status,
          documentId: lockedDocument.id,
          signerId: lockedSigner.id,
          completion: { status: lockedSigner.completionStatus, readyAt: null },
          verificationCode,
          repeated: false,
        };
      });

      committed = !result.repeated;
      if (result.repeated) {
        await this.deleteStored(stored);
      } else if (result.documentId && result.signerId) {
        await this.jobs.enqueueFinalization(result.documentId, result.signerId);
      }
      return result;
    } catch (error) {
      if (!committed) await this.deleteStored(stored);
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
        throw new AppException(...AppErrors.ESIGN_EXTERNAL_UNAUTHORIZED);
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
        throw new AppException(...AppErrors.ESIGN_SIGNATURE_FIELDS_INVALID);
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
        throw new AppException(...AppErrors.ESIGN_SIGNATURE_PNG_INVALID);
      }
      result.set(fieldId, bytes);
    }
    if (result.size !== required.size) {
      throw new AppException(...AppErrors.ESIGN_SIGNATURES_REQUIRED);
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
      throw new AppException(...AppErrors.ESIGN_SIGNATURE_PNG_INVALID);
    }
  }

  private integrity(): AppException {
    return new AppException(...AppErrors.ESIGN_INTEGRITY_FAILED);
  }
}
