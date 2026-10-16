import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppException } from '#app/common/errors/app.exception';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import type {
  EsignAuthenticationMethod,
  SignatureVerificationDocumentDto,
  SignatureVerificationDto,
} from '../dto/signature-verification.dto';
import type { EsignAuditEvent } from '../entities/esign-audit-event.entity';
import type { EsignDocument } from '../entities/esign-document.entity';
import type { EsignSignatureRecord } from '../entities/esign-signature-record.entity';
import type { EsignSigner } from '../entities/esign-signer.entity';
import { AuditEventRepository } from '../repositories/audit-event.repository';
import { DocumentRepository } from '../repositories/document.repository';
import { FileObjectRepository } from '../repositories/file-object.repository';
import { SignatureRecordRepository } from '../repositories/signature-record.repository';
import { SignerRepository } from '../repositories/signer.repository';
import { VerificationRecordRepository } from '../repositories/verification-record.repository';
import {
  auditEventHash,
  canonicalJson,
  canonicalSha256,
} from './esign-audit.service';
import { EsignTokenService } from './esign-token.service';

export const VERIFICATION_MANIFEST_SCHEMA = 'esign-verification-manifest-v1';

/** 結案 transaction 內已鎖定、即將標示完成的文件狀態。 */
export interface VerificationSnapshotInput {
  document: EsignDocument;
  /** 依 sort_order、id 排序的全部簽署人 */
  signers: EsignSigner[];
  finalPdfSha256: string;
  completedAt: Date;
  /** 同 transaction 寫入的 document.completed event hash */
  auditRootHash: string;
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
  finalPdfSha256: string | undefined,
  completedAt: Date | undefined,
) {
  return {
    docNumber: document.docNumber,
    sourcePdfSha256,
    signingPayloadSha256: document.signingPayloadSha256,
    finalPdfSha256,
    completedAt: completedAt?.toISOString(),
  };
}

/** Manifest 的簽署人項目；只放摘要與時間，不放姓名、Email、員編、IP 或簽名圖。 */
function manifestSigner(signer: EsignSigner, record: EsignSignatureRecord) {
  return {
    signerPublicId: signer.publicId,
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
    record.documentSha256 === sourcePdfSha256
  );
}

/**
 * 稽核鏈終點必須是 document.completed；由終點往回走到第一筆事件並逐筆重算 hash，
 * 走得到起點才算完整。
 */
function reachesAuditRoot(
  events: EsignAuditEvent[],
  auditRootHash: string,
): boolean {
  const byHash = new Map(events.map((event) => [event.eventHash, event]));
  let current = byHash.get(auditRootHash);
  if (current?.eventType !== 'document.completed') return false;
  for (let step = 0; current && step < events.length; step += 1) {
    const previous = current.previousEventHash ?? undefined;
    const recalculated = auditEventHash(previous, {
      ...current,
      metadata: current.metadataJson,
    });
    if (recalculated !== current.eventHash) return false;
    if (previous === undefined) return true;
    current = byHash.get(previous);
  }
  return false;
}

/** 取出 manifest 中本人的項目；manifest 形狀不可信，非預期結構一律視為缺漏。 */
function manifestEntryOf(manifest: Record<string, unknown>, publicId: string) {
  const signers = manifest.signers;
  if (!Array.isArray(signers)) return undefined;
  return (signers as Array<Record<string, unknown>>).find(
    (entry) => entry?.signerPublicId === publicId,
  );
}

/** 公開驗證只回 FR-009 白名單欄位。 */
function verificationView(
  { signer, document, record }: SignedEvidence,
  completedPdfSha256: string | null,
): SignatureVerificationDto {
  return {
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
    private readonly audits: AuditEventRepository,
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
    const [source, records] = await Promise.all([
      this.files.findDocumentFile(document.id, 'source_pdf', manager),
      this.records.findBySignerIds(
        signers.map((signer) => signer.id),
        manager,
      ),
    ]);
    const recordBySigner = new Map(
      records.map((record) => [record.signerId, record]),
    );
    if (!source || signers.some((signer) => !recordBySigner.has(signer.id))) {
      throw this.integrity();
    }
    const manifest = {
      schemaVersion: VERIFICATION_MANIFEST_SCHEMA,
      document: manifestDocument(
        document,
        source.sha256,
        input.finalPdfSha256,
        input.completedAt,
      ),
      signers: signers.map((signer) =>
        manifestSigner(signer, recordBySigner.get(signer.id)!),
      ),
      auditRootHash: input.auditRootHash,
    };
    await this.snapshots.insert(
      {
        documentId: document.id,
        publicId: randomUUID(),
        manifestJson: manifest,
        manifestSha256: canonicalSha256(manifest),
        finalPdfSha256: input.finalPdfSha256,
        auditRootHash: input.auditRootHash,
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
    if (!evidenceConsistent(evidence)) {
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
   * 本人項目與簽署紀錄、稽核鏈終點；一致才回傳完成文件摘要。
   */
  private async verifiedFinalPdfSha256(
    { signer, document, record, sourcePdfSha256 }: SignedEvidence,
    manager: EntityManager,
  ): Promise<string> {
    const [snapshot, completedPdf, events] = await Promise.all([
      this.snapshots.findByDocumentId(document.id, manager),
      this.files.findDocumentFile(document.id, 'completed_pdf', manager),
      this.audits.findDocumentEvents(document.id, manager),
    ]);
    const manifest = snapshot?.manifestJson ?? {};
    const expectedDocument = manifestDocument(
      document,
      sourcePdfSha256,
      completedPdf?.sha256,
      document.completedAt,
    );
    const consistent =
      snapshot?.status === 'valid' &&
      canonicalSha256(manifest) === snapshot.manifestSha256 &&
      snapshot.finalPdfSha256 === completedPdf?.sha256 &&
      manifest.auditRootHash === snapshot.auditRootHash &&
      canonicalJson(manifest.document) === canonicalJson(expectedDocument) &&
      canonicalJson(manifestEntryOf(manifest, signer.publicId)) ===
        canonicalJson(manifestSigner(signer, record)) &&
      reachesAuditRoot(events, snapshot.auditRootHash);
    if (!consistent) throw this.integrityFailed(document.id);
    return snapshot.finalPdfSha256;
  }

  private notFound(): AppException {
    return new AppException(
      AppErrorCode.ESIGN_RESOURCE_NOT_FOUND,
      '查無此簽章或驗證碼無效',
      HttpStatus.NOT_FOUND,
    );
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
    return new AppException(
      AppErrorCode.ESIGN_INTEGRITY_FAILED,
      '文件完整性驗證失敗',
      HttpStatus.CONFLICT,
    );
  }
}
