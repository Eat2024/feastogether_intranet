import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { EntityManager } from 'typeorm';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import type { EsignSigner } from '#app/features/esign/entities/esign-signer.entity';
import { DocumentRepository } from '#app/features/esign/repositories/document.repository';
import { FileObjectRepository } from '#app/features/esign/repositories/file-object.repository';
import { SignerRepository } from '#app/features/esign/repositories/signer.repository';
import { SignatureRecordRepository } from '#app/features/esign/repositories/signature-record.repository';
import {
  canonicalSha256,
  EsignAuditService,
} from '#app/features/esign/services/esign-audit.service';
import { CompletedPdfService } from '#app/features/esign/services/completed-pdf.service';
import { EsignVerificationService } from '#app/features/esign/services/esign-verification.service';
import { ESIGN_DOCUMENT_FINALIZATION_QUEUE } from '#app/features/esign/esign-queue.constants';

interface FinalizationJobData {
  documentId: number;
  signerId: number;
}
type CompletedPdfOutput = Awaited<ReturnType<CompletedPdfService['create']>>;
const holdsLease = (
  signer: EsignSigner | null,
  token: string,
): signer is EsignSigner =>
  signer?.status === 'signed' &&
  signer.completionStatus === 'processing' &&
  signer.completionLeaseToken === token;

@Injectable()
@Processor(ESIGN_DOCUMENT_FINALIZATION_QUEUE, { concurrency: 2 })
export class DocumentFinalizationProcessor extends WorkerHost {
  constructor(
    private readonly mysql: MysqlService,
    private readonly documents: DocumentRepository,
    private readonly signers: SignerRepository,
    private readonly files: FileObjectRepository,
    private readonly completedPdf: CompletedPdfService,
    private readonly audit: EsignAuditService,
    private readonly verification: EsignVerificationService,
    @Inject(PRIVATE_FILE_STORAGE) private readonly storage: PrivateFileStorage,
    private readonly records: SignatureRecordRepository,
  ) {
    super();
  }

  async process(job: Job<FinalizationJobData>): Promise<void> {
    // 只合併等待中的重複通知；開始處理後仍由 DB lease 與證據唯一約束決定結果。
    if (job.opts?.deduplication) await job.removeDeduplicationKey();
    const { documentId, signerId } = job.data ?? {};
    if (
      ![documentId, signerId].every((id) => Number.isSafeInteger(id) && id > 0)
    )
      return;
    const token = randomUUID();
    const claimed = await this.mysql.transaction(async (manager) => {
      const document = await this.documents.findByIdForUpdate(
        documentId,
        manager,
      );
      if (
        !document ||
        !['active', 'expired', 'finalizing', 'stopped'].includes(
          document.status,
        )
      )
        return false;
      const signer = await this.signers.findByIdForUpdate(signerId, manager);
      if (
        !signer ||
        signer.documentId !== documentId ||
        signer.status !== 'signed'
      )
        return false;
      const now = new Date();
      const eligible =
        signer.completionStatus === 'pending' ||
        signer.completionStatus === 'failed' ||
        (signer.completionStatus === 'processing' &&
          signer.completionLeaseExpiresAt != null &&
          signer.completionLeaseExpiresAt <= now);
      if (!eligible) return false;
      signer.completionStatus = 'processing';
      signer.completionLeaseToken = token;
      signer.completionLeaseExpiresAt = new Date(now.getTime() + 5 * 60_000);
      signer.completionReadyAt = null;
      await this.signers.save(signer, manager);
      return true;
    });
    if (!claimed) {
      await this.finalizeDocument(documentId);
      return;
    }
    let output: CompletedPdfOutput | undefined;
    let committed = false;
    try {
      output = await this.completedPdf.create(documentId, signerId);
      committed = await this.mysql.transaction((manager) =>
        this.commit(documentId, signerId, token, output!, manager),
      );
      if (!committed) await this.storage.delete(output.stored);
    } catch (error) {
      if (output && !committed)
        await this.storage.delete(output.stored).catch(() => undefined);
      await this.releaseFailedLease(documentId, signerId, token);
      throw error;
    }
    // 個人檔已提交；整體結案失敗不能刪除 ready 檔案或退回個人狀態。
    await this.finalizeDocument(documentId);
  }

  private async commit(
    documentId: number,
    signerId: number,
    token: string,
    output: CompletedPdfOutput,
    manager: EntityManager,
  ): Promise<boolean> {
    const document = await this.documents.findByIdForUpdate(
      documentId,
      manager,
    );
    const signer = await this.signers.findByIdForUpdate(signerId, manager);
    if (
      !document ||
      !['active', 'expired', 'finalizing', 'stopped'].includes(
        document.status,
      ) ||
      !holdsLease(signer, token) ||
      signer.documentId !== documentId
    )
      return false;
    const record = await this.records.findBySignerId(signerId, manager);
    const source = await this.files.findDocumentFile(
      documentId,
      'source_pdf',
      manager,
    );
    if (
      !record ||
      record.id !== output.signatureRecordId ||
      record.signerId !== signerId ||
      record.documentSha256 !== output.sourceSha256 ||
      source?.sha256 !== output.sourceSha256 ||
      record.signingPayloadSha256 !== output.signingPayloadSha256 ||
      document.signingPayloadSha256 !== output.signingPayloadSha256 ||
      canonicalSha256(document.signingPayloadJson) !==
        output.signingPayloadSha256 ||
      signer.signedAt?.getTime() !== record.signedAtUtc.getTime()
    ) {
      throw new Error('個人副本與簽署證據不一致');
    }
    const file = await this.files.save(
      this.files.create(
        {
          signatureRecordId: record.id,
          filePurpose: 'completed_pdf',
          objectKey: output.stored.objectKey,
          objectVersion: output.stored.objectVersion,
          mimeType: output.metadata.mimeType,
          fileSize: output.metadata.fileSize,
          sha256: output.metadata.sha256,
          archiveStatus: 'active',
        },
        manager,
      ),
      manager,
    );
    const readyAt = new Date();
    signer.completionStatus = 'ready';
    signer.completionReadyAt = readyAt;
    signer.completionLeaseToken = null;
    signer.completionLeaseExpiresAt = null;
    await this.signers.save(signer, manager);
    await this.audit.append(
      {
        documentId,
        signerId,
        eventType: 'signer.copy_completed',
        occurredAt: readyAt,
        metadata: {
          signatureRecordId: record.id,
          completedFileId: file.id,
          completedPdfSha256: file.sha256,
        },
      },
      manager,
    );
    return true;
  }

  /** 與個人產製分開提交；maintenance 可直接重試結案，不重製任何 PDF。 */
  async finalizeDocument(documentId: number): Promise<void> {
    await this.mysql.transaction(async (manager) => {
      const document = await this.documents.findByIdForUpdate(
        documentId,
        manager,
      );
      if (document?.status !== 'finalizing') return;
      const counts = await this.signers.completionCounts(documentId, manager);
      if (
        counts.total === 0 ||
        counts.pending !== 0 ||
        counts.ready !== counts.total
      )
        return;
      const signers = await this.signers.findByDocument(documentId, manager);
      const completedAt = new Date();
      document.status = 'completed';
      document.completedAt = completedAt;
      const auditRootHash = await this.audit.append(
        {
          documentId,
          eventType: 'document.completed',
          occurredAt: completedAt,
          metadata: { status: 'completed' },
        },
        manager,
      );
      await this.verification.saveSnapshot(
        { document, signers, completedAt, auditRootHash },
        manager,
      );
      await this.documents.save(document, manager);
    });
  }

  private async releaseFailedLease(
    documentId: number,
    signerId: number,
    token: string,
  ): Promise<void> {
    await this.mysql.transaction(async (manager) => {
      await this.documents.findByIdForUpdate(documentId, manager);
      const signer = await this.signers.findByIdForUpdate(signerId, manager);
      if (!holdsLease(signer, token) || signer.documentId !== documentId)
        return;
      signer.completionStatus = 'failed';
      signer.completionLeaseToken = null;
      signer.completionLeaseExpiresAt = null;
      signer.completionReadyAt = null;
      await this.signers.save(signer, manager);
      await this.audit.append(
        {
          documentId,
          signerId,
          eventType: 'signer.copy_failed',
          occurredAt: new Date(),
          metadata: { errorCode: 'FINALIZATION_FAILED' },
        },
        manager,
      );
    });
  }
}
