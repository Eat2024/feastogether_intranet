import { AppErrorCode } from '#app/common/errors/app-error-code';
import { once } from 'node:events';
import { canonicalSha256 } from '#app/features/esign/services/esign-audit.service';
import { createHash, randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import archiver from 'archiver';
import { Inject, type OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
  type StoredPrivateFile,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { ExportJobRepository } from '#app/features/esign/repositories/export-job.repository';
import { FileObjectRepository } from '#app/features/esign/repositories/file-object.repository';
import type {
  EsignExportJob,
  ExportResolvedFile,
} from '#app/features/esign/entities/esign-export-job.entity';
import { ESIGN_EXPORT_QUEUE } from '#app/features/esign/esign-queue.constants';

const LEASE_MS = 5 * 60_000;
@Processor(ESIGN_EXPORT_QUEUE, { concurrency: 1 })
export class DocumentExportProcessor
  extends WorkerHost
  implements OnModuleInit
{
  constructor(
    private readonly mysql: MysqlService,
    private readonly jobs: ExportJobRepository,
    private readonly files: FileObjectRepository,
    @Inject(PRIVATE_FILE_STORAGE) private readonly storage: PrivateFileStorage,
    @InjectQueue(ESIGN_EXPORT_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }
  async onModuleInit() {
    await this.queue.setGlobalConcurrency(1);
  }
  async process(job: Job<{ exportJobId: number }>): Promise<void> {
    await this.run(job.data.exportJobId);
  }
  async run(id: number): Promise<void> {
    const generation = randomUUID();
    const claim = await this.mysql.transaction(async (m) => {
      const job = await this.jobs.byId(id, m, true);
      if (
        !job?.snapshotJson ||
        !['pending', 'waiting'].includes(job.status) ||
        (job.nextAttemptAt && job.nextAttemptAt > new Date())
      )
        return null;
      if (!(await this.jobs.documentExists(job.documentId!, m))) {
        job.status = 'failed';
        job.failureCode = AppErrorCode.ESIGN_RESOURCE_NOT_FOUND;
        await this.jobs.save(job, m);
        return null;
      }
      job.status = 'processing';
      job.failureCode = null;
      job.leaseToken = generation;
      job.leaseExpiresAt = new Date(Date.now() + LEASE_MS);
      job.attemptCount = (job.attemptCount ?? 0) + 1;
      job.processedCount = 0;
      await this.jobs.save(job, m);
      return job;
    });
    if (!claim) return;
    const abort = new AbortController();
    let stored: StoredPrivateFile | undefined;
    const renewal = setInterval(() => {
      void this.mutate(id, generation, (j) => {
        j.leaseExpiresAt = new Date(Date.now() + LEASE_MS);
      }).catch(() => abort.abort());
    }, 30_000);
    try {
      if (canonicalSha256(claim.snapshotJson) !== claim.snapshotSha256)
        throw new IntegrityError();
      if (claim.stagingJson?.objectKey) {
        await this.storage.delete({
          objectKey: claim.stagingJson.objectKey,
          objectVersion: claim.stagingJson.objectVersion,
          uploadId: claim.stagingJson.uploadId,
        });
        await this.mutate(id, generation, (j) => {
          j.stagingJson = null;
        });
      }
      const resolved = claim.resolvedFilesJson ?? [];
      // 原快照已存在的副本身分不能被可更新的 resolved metadata 置換。
      for (const entry of claim.snapshotJson!) {
        const fixed = resolved.find((f) => f.recordId === entry.recordId);
        if (
          entry.file &&
          fixed &&
          canonicalSha256(entry.file) !== canonicalSha256(fixed)
        )
          throw new IntegrityError();
      }
      const missing = claim.snapshotJson!.filter(
        (s) => !resolved.some((f) => f.recordId === s.recordId),
      );
      const ready = await this.files.findCompletedFiles(
        missing.map((s) => s.recordId),
        this.mysql.getManager(),
      );
      for (const entry of missing) {
        const current = ready.find(
          (f) => f.signatureRecordId === entry.recordId,
        );
        if (entry.file) resolved.push(entry.file);
        else if (current)
          resolved.push({
            recordId: entry.recordId,
            fileId: current.id,
            objectKey: current.objectKey,
            objectVersion: current.objectVersion,
            sha256: current.sha256,
            fileSize: Number(current.fileSize),
          });
      }
      const unresolved = claim.snapshotJson!.filter(
        (entry) => !resolved.some((f) => f.recordId === entry.recordId),
      );
      if (unresolved.length) {
        const records = await this.jobs.snapshotRecords(
          unresolved.map((entry) => entry.recordId),
          this.mysql.getManager(),
        );
        if (
          records.length !== unresolved.length ||
          records.some((record) => record.signer?.completionStatus === 'ready')
        )
          throw new IntegrityError();
        if (
          records.some((record) => record.signer?.completionStatus === 'failed')
        )
          throw new SourceFailedError();
      }
      const waiting = unresolved.length;
      await this.mutate(id, generation, (j) => {
        j.resolvedFilesJson = resolved;
        j.waitingCount = waiting;
        if (waiting) {
          j.status = 'waiting';
          j.nextAttemptAt = new Date(Date.now() + 30_000);
          j.leaseToken = null;
          j.leaseExpiresAt = null;
        }
      });
      if (waiting) return;
      if (!this.storage.storeStream)
        throw new Error('儲存介面尚未支援串流 ZIP');
      // 每一來源僅在上一份已消費後開啟；壓縮與 storage 均保留背壓。
      const archive = archiver('zip', {
        store: true,
        forceZip64: true,
        highWaterMark: 64 * 1024,
      });
      const storagePromise = this.storage.storeStream({
        directory: `exports/job-${id}/${generation}`,
        extension: 'zip',
        mimeType: 'application/zip',
        stream: archive,
        signal: abort.signal,
        expectedSize: resolved.reduce((n, f) => n + f.fileSize + 1024, 0),
        onStaging: async (reference) => {
          await this.mutate(id, generation, (j) => {
            j.stagingJson = { generation, ...reference };
          });
        },
      });
      // 先附加 rejection handler，避免來源校驗期間目的端先失敗造成 unhandled rejection。
      void storagePromise.catch(() => abort.abort());
      archive.on('error', () => abort.abort());
      abort.signal.addEventListener('abort', () => archive.abort(), {
        once: true,
      });
      try {
        let processed = 0;
        for (const entry of claim.snapshotJson!) {
          abort.signal.throwIfAborted();
          const source = resolved.find((f) => f.recordId === entry.recordId)!;
          const stream = await this.storage.openReadStream(source, {
            signal: abort.signal,
          });
          const meter = verifyStream(source);
          const consumed = once(archive, 'entry', { signal: abort.signal });
          archive.append(meter, {
            name: entry.fileName,
            date: claim.snapshotAt ?? new Date(0),
          });
          await Promise.all([
            pipeline(stream, meter, { signal: abort.signal }),
            consumed,
          ]);
          processed += 1;
          if (processed % 25 === 0 || processed === resolved.length)
            await this.mutate(id, generation, (j) => {
              j.processedCount = processed;
            });
        }
        await archive.finalize();
        stored = await storagePromise;
      } catch (error) {
        abort.abort();
        archive.destroy();
        await storagePromise.catch(() => undefined);
        throw error;
      }
      await this.mysql.transaction(async (m) => {
        const current = await this.jobs.byId(id, m, true);
        if (
          !current ||
          current.leaseToken !== generation ||
          current.status !== 'processing' ||
          !current.leaseExpiresAt ||
          current.leaseExpiresAt <= new Date()
        )
          throw new Error('匯出租約已失效');
        if (!(await this.jobs.documentExists(current.documentId!, m)))
          throw new Error('文件已不存在');
        const file = this.files.create(
          {
            ...stored!,
            exportJobId: id,
            filePurpose: 'signed_copies_zip',
            originalFileName: `signed-copies-${current.documentId}.zip`,
            archiveStatus: 'active',
          },
          m,
        );
        await this.files.save(file, m);
        current.status = 'completed';
        current.failureCode = null;
        current.completedAt = new Date();
        current.expiresAt = new Date(
          current.completedAt.getTime() + 7 * 24 * 60 * 60_000,
        );
        current.processedCount = current.recordCount ?? 0;
        current.waitingCount = 0;
        current.leaseToken = null;
        current.leaseExpiresAt = null;
        current.stagingJson = null;
        current.nextAttemptAt = null;
        await this.jobs.save(current, m);
      });
      stored = undefined;
    } catch (error) {
      abort.abort();
      if (stored) await this.storage.delete(stored).catch(() => undefined);
      await this.mysql.transaction(async (m) => {
        const current = await this.jobs.byId(id, m, true);
        if (current?.leaseToken !== generation) return;
        current.status = 'failed';
        current.failureCode =
          error instanceof IntegrityError
            ? AppErrorCode.ESIGN_INTEGRITY_FAILED
            : error instanceof SourceFailedError
              ? AppErrorCode.ESIGN_EXPORT_SOURCE_FAILED
              : AppErrorCode.ESIGN_EXPORT_UNAVAILABLE;
        current.leaseToken = null;
        current.leaseExpiresAt = null;
        await this.jobs.save(current, m);
      });
    } finally {
      clearInterval(renewal);
    }
  }
  private async mutate(
    id: number,
    generation: string,
    apply: (job: EsignExportJob) => void,
  ) {
    await this.mysql.transaction(async (m) => {
      const job = await this.jobs.byId(id, m, true);
      if (
        !job ||
        job.leaseToken !== generation ||
        !job.leaseExpiresAt ||
        job.leaseExpiresAt <= new Date()
      )
        throw new Error('匯出租約已失效');
      apply(job);
      await this.jobs.save(job, m);
    });
  }
  async maintain(now = new Date()) {
    const rows = await this.jobs.maintenance(now, this.mysql.getManager());
    for (const row of rows) {
      const action = await this.mysql.transaction(async (m) => {
        const job = await this.jobs.byId(row.id, m, true);
        if (!job) return null;
        if (
          (job.status === 'completed' || job.status === 'expired') &&
          job.expiresAt &&
          job.expiresAt <= now
        ) {
          job.status = 'expired';
          await this.jobs.save(job, m);
          return { kind: 'expire' as const, id: job.id };
        }
        if (
          job.status === 'processing' &&
          job.leaseExpiresAt &&
          job.leaseExpiresAt <= now
        ) {
          job.status = 'pending';
          job.leaseToken = null;
          job.leaseExpiresAt = null;
          await this.jobs.save(job, m);
        }
        return ['pending', 'waiting'].includes(job.status)
          ? { kind: 'enqueue' as const, id: job.id }
          : null;
      });
      // 慢 storage／Redis I/O 不占用業務交易鎖。
      if (action?.kind === 'expire') {
        const files = await this.jobs.files(action.id, this.mysql.getManager());
        for (const file of files)
          if (file.archiveStatus === 'active') {
            await this.storage.delete(file);
            await this.jobs.archiveFile(file.id, this.mysql.getManager());
          }
      }
      if (action?.kind === 'enqueue')
        await this.queue.add(
          'export',
          { exportJobId: action.id },
          {
            attempts: 1,
            removeOnComplete: 1000,
            removeOnFail: 1000,
            deduplication: { id: `export-${action.id}` },
          },
        );
    }
    await this.storage.cleanupExports?.(
      new Date(now.getTime() - 24 * 60 * 60_000),
      100,
      (reference) =>
        this.jobs.isReferenced(
          reference.objectKey,
          this.mysql.getManager(),
          now,
        ),
    );
  }
}
class SourceFailedError extends Error {
  constructor() {
    super('既有已簽副本產製失敗');
  }
}
class IntegrityError extends Error {
  constructor() {
    super('來源副本完整性異常');
  }
}
function verifyStream(file: ExportResolvedFile) {
  const hash = createHash('sha256');
  let size = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      hash.update(chunk);
      done(null, chunk);
    },
    flush(done) {
      done(
        size === file.fileSize && hash.digest('hex') === file.sha256
          ? undefined
          : new IntegrityError(),
      );
    },
  });
}
