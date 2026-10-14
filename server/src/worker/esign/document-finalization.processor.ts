import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { DocumentRepository } from '#app/features/esign/repositories/document.repository';
import { FileObjectRepository } from '#app/features/esign/repositories/file-object.repository';
import { SignerRepository } from '#app/features/esign/repositories/signer.repository';
import { EsignAuditService } from '#app/features/esign/services/esign-audit.service';
import { CompletedPdfService } from '#app/features/esign/services/completed-pdf.service';
import { ESIGN_DOCUMENT_FINALIZATION_QUEUE } from '#app/features/esign/esign-queue.constants';

interface FinalizationJobData {
  documentId: number;
}

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
      if (
        signers.length === 0 ||
        signers.some((signer) => signer.status !== 'signed')
      )
        return false;
      document.status = 'finalizing';
      document.finalizationLeaseToken = leaseToken;
      document.finalizationLeaseExpiresAt = new Date(
        now.getTime() + 5 * 60_000,
      );
      await this.documents.save(document, manager);
      return true;
    });
    if (!claimed) return;

    let output: Awaited<ReturnType<CompletedPdfService['create']>> | undefined;
    try {
      output = await this.completedPdf.create(documentId);
      const committed = await this.mysql.transaction(async (manager) => {
        const document = await this.documents.findByIdForUpdate(
          documentId,
          manager,
        );
        if (
          !document ||
          document.status !== 'finalizing' ||
          document.finalizationLeaseToken !== leaseToken
        )
          return false;
        const signers = await this.signers.findByDocumentForUpdate(
          documentId,
          manager,
        );
        if (
          signers.length === 0 ||
          signers.some((signer) => signer.status !== 'signed')
        )
          return false;
        const completedAt = new Date();
        await this.files.save(
          this.files.create(
            {
              documentId,
              filePurpose: 'completed_pdf',
              objectKey: output!.stored.objectKey,
              objectVersion: output!.stored.objectVersion,
              mimeType: output!.metadata.mimeType,
              fileSize: output!.metadata.fileSize,
              sha256: output!.metadata.sha256,
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
        await this.audit.append(
          {
            documentId,
            eventType: 'document.completed',
            occurredAt: completedAt,
            metadata: { status: 'completed' },
          },
          manager,
        );
        return true;
      });
      if (!committed) await this.storage.delete(output.stored);
    } catch (error) {
      if (output)
        await this.storage.delete(output.stored).catch(() => undefined);
      await this.releaseFailedLease(documentId, leaseToken);
      throw error;
    }
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
      if (
        !document ||
        document.status !== 'finalizing' ||
        document.finalizationLeaseToken !== leaseToken
      )
        return;
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
