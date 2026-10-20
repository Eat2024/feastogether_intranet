import { canonicalSha256 } from './esign-audit.service';
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { AppException } from '#app/common/errors/app.exception';
import { AppErrors } from '#app/common/errors/app-errors';
import { ExportJobRepository } from '../repositories/export-job.repository';
import { DocumentRepository } from '../repositories/document.repository';
import { FileObjectRepository } from '../repositories/file-object.repository';
import {
  type EsignExportJob,
  type ExportSnapshotEntry,
} from '../entities/esign-export-job.entity';
import { type ExportQueryDto } from '../dto/export.dto';
import {
  ESIGN_EXPORT_QUEUE,
  exportJobArguments,
} from '../esign-queue.constants';

@Injectable()
export class EsignExportService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly jobs: ExportJobRepository,
    private readonly documents: DocumentRepository,
    private readonly files: FileObjectRepository,
    @Inject(PRIVATE_FILE_STORAGE) private readonly storage: PrivateFileStorage,
    @InjectQueue(ESIGN_EXPORT_QUEUE) private readonly queue: Queue,
  ) {}

  async request(documentId: number, userId: number) {
    const result = await this.mysql.transaction(async (m) => {
      const doc = await this.documents.findByIdForUpdate(documentId, m);
      if (!doc) throw new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
      const reusable = await this.jobs.reusable(documentId, new Date(), m);
      if (reusable) return { job: reusable, reused: true };
      const records = await this.jobs.records(documentId, m);
      if (!records.length)
        throw new AppException(...AppErrors.ESIGN_EXPORT_EMPTY);
      const ready = await this.files.findCompletedFiles(
        records.map((r) => r.id),
        m,
      );
      const readyByRecord = new Map(
        ready.map((file) => [file.signatureRecordId, file]),
      );
      const snapshot: ExportSnapshotEntry[] = records.map((record) => {
        const signer = record.signer!;
        const file = readyByRecord.get(record.id);
        return {
          recordId: record.id,
          signerPublicId: signer.publicId,
          fileName: safeName(signer.nameSnapshot, signer.publicId),
          ...(file
            ? {
                file: {
                  recordId: record.id,
                  fileId: file.id,
                  objectKey: file.objectKey,
                  objectVersion: file.objectVersion,
                  sha256: file.sha256,
                  fileSize: Number(file.fileSize),
                },
              }
            : {}),
        };
      });
      const job = this.jobs.create(
        {
          publicId: randomUUID(),
          documentId,
          createdByUserId: userId,
          exportType: 'signed_copies_zip',
          status: 'pending',
          scopeDescription: '此次簽署的所有已簽副本',
          snapshotAt: new Date(),
          snapshotJson: snapshot,
          // 受理時已固定的副本同次持久化，worker 不重查/重存 6,000 份 metadata。
          resolvedFilesJson: snapshot.flatMap((entry) =>
            entry.file ? [entry.file] : [],
          ),
          snapshotSha256: canonicalSha256(snapshot),
          recordCount: snapshot.length,
          processedCount: 0,
          waitingCount: snapshot.filter((s) => !s.file).length,
          attemptCount: 0,
        },
        m,
      );
      return { job: await this.jobs.save(job, m), reused: false };
    });
    if (result.job.status === 'completed')
      await this.assertAvailable(result.job);
    if (['pending', 'waiting'].includes(result.job.status))
      await this.enqueue(result.job.id);
    return { ...(await this.view(result.job)), reused: result.reused };
  }
  async detail(documentId: number, publicId: string) {
    return this.view(await this.find(documentId, publicId));
  }
  async find(documentId: number, publicId: string) {
    const m = this.mysql.getManager();
    if (!(await this.jobs.documentExists(documentId, m)))
      throw new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
    const job = await this.jobs.find(publicId, documentId, m);
    if (!job?.snapshotJson)
      throw new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
    return job;
  }
  async retry(documentId: number, publicId: string) {
    const job = await this.mysql.transaction(async (m) => {
      if (!(await this.documents.findByIdForUpdate(documentId, m)))
        throw new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
      const original = await this.jobs.find(publicId, documentId, m, true);
      if (!original?.snapshotJson)
        throw new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
      const other = await this.jobs.reusable(documentId, new Date(), m);
      if (other && other.id !== original.id && other.status !== 'failed')
        return other;
      if (['pending', 'waiting', 'processing'].includes(original.status))
        return original;
      if (
        original.status !== 'failed' ||
        original.failureCode === 'ESIGN_INTEGRITY_FAILED'
      )
        throw new AppException(...AppErrors.ESIGN_EXPORT_RETRY_INVALID);
      original.status = 'pending';
      original.failureCode = null;
      original.nextAttemptAt = null;
      original.processedCount = 0;
      return this.jobs.save(original, m);
    });
    if (job.status === 'completed') await this.assertAvailable(job);
    else await this.enqueue(job.id);
    return this.view(job);
  }
  async listDocuments(q: ExportQueryDto) {
    const m = this.mysql.getManager();
    const rows = await this.jobs.documents(q, m);
    const more = rows.length > q.limit;
    const selected = rows.slice(0, q.limit);
    const items = await Promise.all(
      selected.map(async (doc) => ({
        documentId: String(doc.id),
        title: doc.title,
        creatorName: doc.createdByUser?.name ?? '',
        status: doc.status,
        signedCount: await this.jobs.signedCount(doc.id, m),
        latestExportSummary: await this.summary(
          await this.jobs.latest(doc.id, m),
        ),
      })),
    );
    return {
      items,
      nextCursor: more ? String(selected[selected.length - 1].id) : null,
    };
  }
  async history(q: ExportQueryDto) {
    const rows = await this.jobs.history(
      { ...q, documentId: q.documentId ? Number(q.documentId) : undefined },
      this.mysql.getManager(),
    );
    const selected = rows.slice(0, q.limit);
    return {
      items: await Promise.all(
        selected.map(async (j) => ({
          ...(await this.view(j)),
          requesterName: j.createdByUser?.name ?? '',
        })),
      ),
      nextCursor:
        rows.length > q.limit ? String(selected[selected.length - 1].id) : null,
    };
  }
  async view(job: EsignExportJob) {
    const expired = job.expiresAt && job.expiresAt <= new Date();
    const files = await this.jobs.files(job.id, this.mysql.getManager());
    return {
      id: job.publicId!,
      documentId: String(job.documentId),
      status: expired ? 'expired' : job.status,
      snapshotAt: job.snapshotAt?.toISOString() ?? null,
      expectedCount: Number(job.recordCount ?? 0),
      processedCount: job.processedCount ?? 0,
      waitingCount: job.waitingCount ?? 0,
      completedAt: job.completedAt?.toISOString() ?? null,
      expiresAt: job.expiresAt?.toISOString() ?? null,
      failureCode: job.failureCode ?? null,
      files:
        job.status === 'completed' && !expired
          ? files.map((f) => ({
              id: String(f.id),
              fileName: f.originalFileName ?? 'signed-copies.zip',
              size: Number(f.fileSize),
              sha256: f.sha256,
              downloadPath: `/api/esign/documents/${job.documentId}/exports/${job.publicId}/files/${f.id}`,
            }))
          : [],
    };
  }
  async summary(job: EsignExportJob | null) {
    return job?.snapshotJson ? this.view(job) : null;
  }
  async download(documentId: number, publicId: string, fileId: number) {
    const job = await this.find(documentId, publicId);
    if (
      job.status === 'expired' ||
      (job.expiresAt && job.expiresAt <= new Date())
    )
      throw new AppException(...AppErrors.ESIGN_EXPORT_EXPIRED);
    const files = await this.jobs.files(job.id, this.mysql.getManager());
    const file = files.find((f) => f.id === fileId);
    if (job.status !== 'completed')
      throw new AppException(...AppErrors.ESIGN_EXPORT_NOT_READY);
    if (!file) throw new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
    await this.assertAvailable(job);
    return file;
  }
  async assertAvailable(job: EsignExportJob) {
    try {
      const files = await this.jobs.files(job.id, this.mysql.getManager());
      if (files.length !== 1 || !this.storage.stat)
        throw new Error('缺少匯出成果');
      for (const file of files)
        if ((await this.storage.stat(file)).fileSize !== Number(file.fileSize))
          throw new Error('成果大小異常');
    } catch {
      throw new AppException(...AppErrors.ESIGN_EXPORT_UNAVAILABLE);
    }
  }
  async enqueue(id: number) {
    try {
      await this.queue.add(...exportJobArguments(id));
    } catch {
      /* 持久工作由 maintenance 補列。 */
    }
  }
}
function safeName(name: string, id: string) {
  const safe =
    Array.from(
      name.replace(/[\\/\p{Cc}<>:"|?*]/gu, '_').replace(/^[. ]+|[. ]+$/g, ''),
    )
      .slice(0, 60)
      .join('') || '簽署人';
  return `副本_${safe}_${id}.pdf`;
}
