import { AppErrors } from '#app/common/errors/app-errors';
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AppException } from '#app/common/errors/app.exception';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import type {
  EsignAuthenticationMethod,
  SignatureVerificationDocumentDto,
  SignatureVerificationDto,
} from '../dto/signature-verification.dto';
import type { EsignFileObject } from '../entities/esign-file-object.entity';
import type { EsignDocument } from '../entities/esign-document.entity';
import type { EsignSignatureRecord } from '../entities/esign-signature-record.entity';
import type { EsignSigner } from '../entities/esign-signer.entity';
import { DocumentRepository } from '../repositories/document.repository';
import { FileObjectRepository } from '../repositories/file-object.repository';
import { SignatureRecordRepository } from '../repositories/signature-record.repository';
import { SignerRepository } from '../repositories/signer.repository';
import { VerificationRecordRepository } from '../repositories/verification-record.repository';
import { canonicalJson, canonicalSha256 } from '../helpers/signing-evidence';
import { EsignTokenService } from './esign-token.service';

const REJECTION_MANIFEST_SCHEMA = 'esign-verification-manifest-v3';
export const VERIFICATION_MANIFEST_SCHEMA = 'esign-verification-manifest-v4';

/** 結案 transaction 內已鎖定、即將標示完成的文件狀態。 */
export interface VerificationSnapshotInput {
  document: EsignDocument;
  /** 依 sort_order、id 排序的全部簽署人 */
  signers: EsignSigner[];
  completedAt: Date;
}

interface SignedEvidence {
  signer: EsignSigner;
  document: EsignDocument;
  record: EsignSignatureRecord;
  /** 文件 active 原始 PDF file object 的摘要 */
  sourcePdfSha256?: string;
}

/** Manifest 的文件項目；快照寫入與公開驗證以同一規則組出後比對。 */
function manifestDocument(
  document: EsignDocument,
  sourcePdfSha256: string | undefined,
  completedAt: Date | undefined,
) {
  return {
    docNumber: document.docNumber,
    sourcePdfSha256,
    signingPayloadSha256: document.signingPayloadSha256,
    completedAt: completedAt?.toISOString(),
  };
}

/** Manifest 的簽署人項目；只放摘要與時間，不放姓名、Email、員編、IP 或簽名圖。 */
function manifestSigner(
  signer: EsignSigner,
  record: EsignSignatureRecord,
  file: EsignFileObject,
) {
  return {
    signerPublicId: signer.publicId,
    signatureRecordId: record.id,
    completedFileId: file.id,
    completedPdfSha256: file.sha256,
    signedAt: record.signedAtUtc.toISOString(),
    authenticationMethod: record.authenticationMethod,
    consentVersion: record.consentVersion,
    documentSha256: record.documentSha256,
    signingPayloadSha256: record.signingPayloadSha256,
  };
}

/** 簽署紀錄必須與簽署人時間、文件簽署參數及原始 PDF 摘要一致（FR-008）。 */
function evidenceConsistent({
  signer,
  document,
  record,
  sourcePdfSha256,
}: SignedEvidence): boolean {
  return (
    signer.signedAt?.getTime() === record.signedAtUtc.getTime() &&
    record.signingPayloadSha256 === document.signingPayloadSha256 &&
    record.documentSha256 === sourcePdfSha256 &&
    record.signerId === signer.id
  );
}

/** 取出 manifest 中本人的項目；manifest 形狀不可信，非預期結構一律視為缺漏。 */
function manifestEntryOf(manifest: Record<string, unknown>, publicId: string) {
  const signers = manifest.signers;
  if (!Array.isArray(signers)) return undefined;
  return (signers as Array<Record<string, unknown>>).find(
    (entry) => entry?.signerPublicId === publicId,
  );
}

/** 個人完成 PDF 必須僅歸屬此簽署紀錄。 */
function copyConsistent(
  file: EsignFileObject,
  record: EsignSignatureRecord,
): boolean {
  return (
    file.signatureRecordId === record.id &&
    file.documentId == null &&
    file.documentFieldId == null &&
    file.verificationRecordId == null &&
    file.exportJobId == null &&
    file.filePurpose === 'completed_pdf' &&
    file.archiveStatus === 'active'
  );
}

/** 公開驗證只回 FR-009 白名單欄位。 */
function verificationView(
  { signer, document, record }: SignedEvidence,
  completedPdfSha256: string | null,
): SignatureVerificationDto {
  return {
    verificationScope: 'stored_records',
    signature: {
      signerName: signer.nameSnapshot,
      signedAt: record.signedAtUtc.toISOString(),
      authenticationMethod:
        record.authenticationMethod as EsignAuthenticationMethod,
    },
    document: {
      title: document.title,
      status: document.status as SignatureVerificationDocumentDto['status'],
      signedSourceSha256: record.documentSha256,
      completedAt: document.completedAt?.toISOString() ?? null,
      stoppedAt: document.stoppedAt?.toISOString() ?? null,
      completedPdfSha256,
    },
  };
}

@Injectable()
export class EsignVerificationService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly documents: DocumentRepository,
    private readonly signers: SignerRepository,
    private readonly records: SignatureRecordRepository,
    private readonly files: FileObjectRepository,
    private readonly snapshots: VerificationRecordRepository,
    private readonly tokens: EsignTokenService,
    private readonly logger: AppLoggerService,
  ) {}

  /** 結案 transaction 內寫入文件驗證快照；任何缺漏都拋錯讓整筆結案 rollback。 */
  async saveSnapshot(
    input: VerificationSnapshotInput,
    manager: EntityManager,
  ): Promise<void> {
    const { document, signers } = input;
    const source = await this.files.findDocumentFile(
      document.id,
      'source_pdf',
      manager,
    );
    if (
      !source ||
      signers.length === 0 ||
      canonicalSha256(document.signingPayloadJson) !==
        document.signingPayloadSha256
    )
      throw this.integrity();
    const rejected = signers
      .filter((signer) => signer.status === 'rejected')
      .map((signer) => {
        if (
          !signer.rejectedAt ||
          signer.signedAt ||
          signer.completionStatus != null
        )
          throw this.integrity();
        return {
          signerPublicId: signer.publicId,
          rejectedAt: signer.rejectedAt.toISOString(),
          reasonSha256: canonicalSha256(signer.rejectReason),
        };
      });
    if (
      signers.some((signer) => !['signed', 'rejected'].includes(signer.status))
    )
      throw this.integrity();
    const signed = signers.filter((signer) => signer.status === 'signed');
    const entries: ReturnType<typeof manifestSigner>[] = [];
    for (let offset = 0; offset < signed.length; offset += 250) {
      const batch = signed.slice(offset, offset + 250);
      const records = await this.records.findBySignerIds(
        batch.map((signer) => signer.id),
        manager,
      );
      const files = await this.files.findCompletedFiles(
        records.map((record) => record.id),
        manager,
      );
      const recordBySigner = new Map(
        records.map((record) => [record.signerId, record]),
      );
      const fileByRecord = new Map(
        files.map((file) => [file.signatureRecordId, file]),
      );
      for (const signer of batch) {
        const record = recordBySigner.get(signer.id);
        const file = record && fileByRecord.get(record.id);
        if (
          !record ||
          !file ||
          signer.status !== 'signed' ||
          signer.completionStatus !== 'ready' ||
          !evidenceConsistent({
            signer,
            document,
            record,
            sourcePdfSha256: source.sha256,
          }) ||
          !copyConsistent(file, record)
        )
          throw this.integrity();
        entries.push(manifestSigner(signer, record, file));
      }
    }
    const manifest = {
      schemaVersion: VERIFICATION_MANIFEST_SCHEMA,
      ...(rejected.length ? { rejected } : {}),
      document: manifestDocument(document, source.sha256, input.completedAt),
      signers: entries,
    };
    await this.snapshots.insert(
      {
        documentId: document.id,
        publicId: randomUUID(),
        manifestJson: manifest,
        manifestSha256: canonicalSha256(manifest),
        finalPdfSha256: null,
        auditRootHash: null,
        status: 'valid',
        issuedAt: input.completedAt,
      },
      manager,
    );
  }

  /** 公開驗證：代碼格式不符不查 DB；只讀、不 lock、不寫任何資料或稽核事件。 */
  async verify(code: string): Promise<SignatureVerificationDto> {
    if (!this.tokens.isVerificationCodeFormat(code)) throw this.notFound();
    const manager = this.mysql.getManager();
    const evidence = await this.signedEvidence(code, manager);
    if (
      !evidenceConsistent(evidence) ||
      canonicalSha256(evidence.document.signingPayloadJson) !==
        evidence.document.signingPayloadSha256
    ) {
      throw this.integrityFailed(evidence.document.id);
    }
    const completedPdfSha256 =
      evidence.document.status === 'completed'
        ? await this.verifiedFinalPdfSha256(evidence, manager)
        : null;
    return verificationView(evidence, completedPdfSha256);
  }

  /** 查無代碼、簽署人已刪除或未簽署、文件為草稿或已刪除，一律同一個 404。 */
  private async signedEvidence(
    code: string,
    manager: EntityManager,
  ): Promise<SignedEvidence> {
    const record = await this.records.findByVerificationCode(code, manager);
    if (!record) throw this.notFound();
    const signer = await this.signers.findById(record.signerId, manager);
    if (signer?.status !== 'signed') throw this.notFound();
    const [document, source] = await Promise.all([
      this.documents.findById(signer.documentId, manager),
      this.files.findDocumentFile(signer.documentId, 'source_pdf', manager),
    ]);
    if (!document || document.status === 'draft') throw this.notFound();
    return { signer, document, record, sourcePdfSha256: source?.sha256 };
  }

  /**
   * 比對有效的驗證快照：manifest 自身摘要、文件項目與現存文件及完成 PDF、
   * 本人項目與簽署紀錄；不再驗證已停用的事件鏈。
   */
  private async verifiedFinalPdfSha256(
    { signer, document, record, sourcePdfSha256 }: SignedEvidence,
    manager: EntityManager,
  ): Promise<string> {
    const [snapshot, completedPdf] = await Promise.all([
      this.snapshots.findByDocumentId(document.id, manager),
      this.files.findCompletedFile(record.id, manager),
    ]);
    const manifest = snapshot?.manifestJson ?? {};
    const expectedDocument = manifestDocument(
      document,
      sourcePdfSha256,
      document.completedAt,
    );
    const entry = manifestEntryOf(manifest, signer.publicId);
    // 舊 manifest 保留原始 bytes/hash；只在證據欄位比對時排除已停用的事件 hash。
    const comparableEntry = entry && { ...entry };
    if (
      comparableEntry &&
      manifest.schemaVersion !== VERIFICATION_MANIFEST_SCHEMA
    )
      delete comparableEntry.copyCompletedEventHash;
    const rejectedConsistent = await this.rejectionsConsistent(
      manifest,
      document.id,
      manager,
    );
    const consistent =
      snapshot?.status === 'valid' &&
      [
        VERIFICATION_MANIFEST_SCHEMA,
        REJECTION_MANIFEST_SCHEMA,
        'esign-verification-manifest-v2',
      ].includes(String(manifest.schemaVersion)) &&
      rejectedConsistent &&
      signer.completionStatus === 'ready' &&
      completedPdf &&
      copyConsistent(completedPdf, record) &&
      canonicalSha256(manifest) === snapshot.manifestSha256 &&
      snapshot.finalPdfSha256 === null &&
      (manifest.schemaVersion === VERIFICATION_MANIFEST_SCHEMA
        ? snapshot.auditRootHash === null &&
          manifest.auditRootHash === undefined
        : manifest.auditRootHash === snapshot.auditRootHash) &&
      canonicalJson(manifest.document) === canonicalJson(expectedDocument) &&
      canonicalJson(comparableEntry) ===
        canonicalJson(manifestSigner(signer, record, completedPdf));
    if (!consistent) throw this.integrityFailed(document.id);
    return completedPdf.sha256;
  }

  private async rejectionsConsistent(
    manifest: Record<string, unknown>,
    documentId: number,
    manager: EntityManager,
  ): Promise<boolean> {
    const signers = await this.signers.findByDocument(documentId, manager);
    const rejected = signers.filter((signer) => signer.status === 'rejected');
    const entries = manifest.rejected ?? [];
    if (!Array.isArray(entries) || entries.length !== rejected.length)
      return false;
    const seen = new Set<string>();
    return entries.every((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return false;
      const row = entry as Record<string, unknown>;
      const signer = rejected.find(
        (signer) => signer.publicId === row.signerPublicId,
      );
      if (!signer || seen.has(signer.publicId)) return false;
      seen.add(signer.publicId);
      return (
        !signer.signedAt &&
        signer.completionStatus == null &&
        !!signer.rejectedAt &&
        row.rejectedAt === signer.rejectedAt.toISOString() &&
        row.reasonSha256 === canonicalSha256(signer.rejectReason)
      );
    });
  }

  private notFound(): AppException {
    return new AppException(...AppErrors.ESIGN_VERIFICATION_NOT_FOUND);
  }

  /** 公開驗證不一致：記錄不含 token 的告警後回 409，回應不揭露哪一項不一致。 */
  private integrityFailed(documentId: number): AppException {
    this.logger.warn({
      context: EsignVerificationService.name,
      event: 'esign.verification_integrity_failed',
      message: '簽章驗證資料不一致',
      metadata: { documentId },
    });
    return this.integrity();
  }

  private integrity(): AppException {
    return new AppException(...AppErrors.ESIGN_INTEGRITY_FAILED);
  }
}
