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
import type { EsignDocument } from '#app/features/esign/entities/esign-document.entity';
import type { EsignSigner } from '#app/features/esign/entities/esign-signer.entity';
import { DocumentRepository } from '#app/features/esign/repositories/document.repository';
import { FileObjectRepository } from '#app/features/esign/repositories/file-object.repository';
import { SignerRepository } from '#app/features/esign/repositories/signer.repository';
import { EsignAuditService } from '#app/features/esign/services/esign-audit.service';
import { CompletedPdfService } from '#app/features/esign/services/completed-pdf.service';
import { EsignVerificationService } from '#app/features/esign/services/esign-verification.service';
import { ESIGN_DOCUMENT_FINALIZATION_QUEUE } from '#app/features/esign/esign-queue.constants';

interface FinalizationJobData {
  documentId: number;
}

type CompletedPdfOutput = Awaited<ReturnType<CompletedPdfService['create']>>;

const allSigned = (signers: EsignSigner[]): boolean =>
  signers.length > 0 && signers.every((signer) => signer.status === 'signed');

const holdsLease = (
  document: EsignDocument | null,
  leaseToken: string,
): document is EsignDocument =>
  document?.status === 'finalizing' &&
  document.finalizationLeaseToken === leaseToken;

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
    @Inject(PRIVATE_FILE_STORAGE)
    private readonly storage: PrivateFileStorage,
  ) {
    super();
  }

  async process(job: Job<FinalizationJobData>): Promise<void> {
    const documentId = job.data?.documentId;
    if (!Number.isSafeInteger(documentId) || documentId < 1) return;
    const leaseToken = randomUUID();
    const claimed = await this.mysql.transaction(async (manager) => {
      const document = await this.documents.findByIdForUpdate(
        documentId,
        manager,
      );
      if (
        !document ||
        document.status === 'completed' ||
        document.status === 'stopped'
      )
        return false;
      const now = new Date();
      const reclaimable =
        document.status === 'finalizing' &&
        document.finalizationLeaseExpiresAt !== undefined &&
        document.finalizationLeaseExpiresAt <= now;
      if (document.status !== 'active' && !reclaimable) return false;
      const signers = await this.signers.findByDocumentForUpdate(
        documentId,
        manager,
      );
      if (!allSigned(signers)) return false;
      document.status = 'finalizing';
      document.finalizationLeaseToken = leaseToken;
      document.finalizationLeaseExpiresAt = new Date(
        now.getTime() + 5 * 60_000,
      );
      await this.documents.save(document, manager);
      return true;
    });
    if (!claimed) return;

    let output: CompletedPdfOutput | undefined;
    try {
      output = await this.completedPdf.create(documentId);
      const committed = await this.mysql.transaction((manager) =>
        this.commit(documentId, leaseToken, output!, manager),
      );
      if (!committed) await this.storage.delete(output.stored);
    } catch (error) {
      if (output)
        await this.storage.delete(output.stored).catch(() => undefined);
      await this.releaseFailedLease(documentId, leaseToken);
      throw error;
    }
  }

  /**
   * 仍持有 lease 且全員已簽時，同一 transaction 寫入完成檔、文件狀態、
   * document.completed 與驗證快照；任一失敗整筆 rollback。失去 lease 回 false。
   */
  private async commit(
    documentId: number,
    leaseToken: string,
    output: CompletedPdfOutput,
    manager: EntityManager,
  ): Promise<boolean> {
    const document = await this.documents.findByIdForUpdate(
      documentId,
      manager,
    );
    if (!holdsLease(document, leaseToken)) return false;
    const signers = await this.signers.findByDocumentForUpdate(
      documentId,
      manager,
    );
    if (!allSigned(signers)) return false;
    const completedAt = new Date();
    await this.files.save(
      this.files.create(
        {
          documentId,
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
    for (const signer of signers) {
      if (signer.signerType === 'email' && signer.completionReceiptSha256) {
        signer.completionReceiptExpiresAt = new Date(
          completedAt.getTime() + 30 * 24 * 60 * 60_000,
        );
      }
    }
    await this.signers.saveMany(signers, manager);
    document.status = 'completed';
    document.completedAt = completedAt;
    document.finalizationLeaseToken = undefined;
    document.finalizationLeaseExpiresAt = undefined;
    await this.documents.save(document, manager);
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
      {
        document,
        signers,
        finalPdfSha256: output.metadata.sha256,
        completedAt,
        auditRootHash,
      },
      manager,
    );
    return true;
  }

  private async releaseFailedLease(
    documentId: number,
    leaseToken: string,
  ): Promise<void> {
    await this.mysql.transaction(async (manager) => {
      const document = await this.documents.findByIdForUpdate(
        documentId,
        manager,
      );
      if (!holdsLease(document, leaseToken)) return;
      document.status = 'active';
      document.finalizationLeaseToken = undefined;
      document.finalizationLeaseExpiresAt = undefined;
      await this.documents.save(document, manager);
      await this.audit.append(
        {
          documentId,
          eventType: 'document.finalization_failed',
          occurredAt: new Date(),
          metadata: { errorCode: 'FINALIZATION_FAILED' },
        },
        manager,
      );
    });
  }
}
