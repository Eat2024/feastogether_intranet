import { exportActorView } from '../helpers/export-actor';
import type { Actor } from '#app/features/auth/auth.types';
import { AuthorizationService } from '#app/features/authorization/services/authorization.service';
import { exportFileName } from '../helpers/export-file-name';
import type {
  PrepareExportDownloadDto,
  PreparedExportDownloadDto,
} from '../dto/export.dto';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { canonicalSha256 } from '../helpers/signing-evidence';
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { EntityManager } from 'typeorm';
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
import { type ExportQueryDto, type ExportJobViewDto } from '../dto/export.dto';
import {
  ESIGN_EXPORT_QUEUE,
  exportJobArguments,
} from '../esign-queue.constants';

interface ExportRequestResult {
  job: EsignExportJob;
  reused: boolean;
}

@Injectable()
export class EsignExportService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly jobs: ExportJobRepository,
    private readonly documents: DocumentRepository,
    private readonly files: FileObjectRepository,
    @Inject(PRIVATE_FILE_STORAGE) private readonly storage: PrivateFileStorage,
    @InjectQueue(ESIGN_EXPORT_QUEUE) private readonly queue: Queue,
    private readonly access: EsignAccessPolicyService,
    private readonly authorization: AuthorizationService,
  ) {}

  /** 準備當次下載；ZIP 在資格與成果驗證成功後保存首次提供的檔名。 */
  async prepareDownload(
    documentId: number,
    actor: Actor,
    body: PrepareExportDownloadDto,
  ): Promise<PreparedExportDownloadDto> {
    await this.authorization.requirePermissions(actor, [
      body.type === 'excel' ? 'esign.export.create' : 'esign.export.read',
    ]);
    const manager = this.mysql.getManager();
    const document = await this.access.exportDocument(
      await this.documents.findById(documentId, manager),
      actor,
      body.type === 'excel' ? 'esign.export.create' : 'esign.export.read',
      manager,
    );
    if (document.status === 'draft')
      throw new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
    const fileName = exportFileName(body.fileName, body.type);
    if (body.type === 'excel') {
      if (body.exportId !== undefined || body.fileId !== undefined)
        throw new AppException(
          ...AppErrors.ESIGN_EXPORT_DOWNLOAD_REFERENCE_INVALID,
        );
      return { type: 'excel', fileName };
    }
    if (!body.exportId || !body.fileId)
      throw new AppException(
        ...AppErrors.ESIGN_EXPORT_DOWNLOAD_REFERENCE_INVALID,
      );
    const file = await this.download(
      documentId,
      body.exportId,
      Number(body.fileId),
      actor,
    );
    const downloadFileName =
      fileName ?? file.originalFileName ?? 'signed-copies.zip';
    await this.recordDownloadFileName(
      file.exportJobId!,
      downloadFileName,
      documentId,
      actor,
    );
    return {
      type: 'zip',
      fileName: downloadFileName,
      downloadPath: `/api/esign/documents/${documentId}/exports/${body.exportId}/files/${file.id}${fileName === null ? '' : '?downloadName=client'}`,
    };
  }

  /** 下載檔名寫入前，在同一交易重新驗證當前 read 能力與文件範圍。 */
  recordDownloadFileName(
    jobId: number,
    fileName: string,
    documentId: number,
    actor: Actor,
  ) {
    return this.mysql.transaction(async (manager) => {
      await this.access.exportDocument(
        await this.documents.findById(documentId, manager),
        actor,
        'esign.export.read',
        manager,
      );
      return this.jobs.recordDownloadFileName(jobId, fileName, manager);
    }, 'READ COMMITTED');
  }

  async request(documentId: number, actor: Actor) {
    const result = await this.mysql.transaction(
      (manager) => this.findOrCreateExportJob(documentId, actor, manager),
      'READ COMMITTED',
    );
    await this.ensureAvailableOrEnqueue(result.job);
    return { ...(await this.view(result.job)), reused: result.reused };
  }

  /** 鎖定文件，優先沿用既有工作；沒有可沿用工作時建立並保存新工作。 */
  private async findOrCreateExportJob(
    documentId: number,
    actor: Actor,
    manager: EntityManager,
  ): Promise<ExportRequestResult> {
    await this.authorization.requirePermissions(
      actor,
      ['esign.export.create'],
      manager,
    );
    const document = await this.documents.findByIdForUpdate(
      documentId,
      manager,
    );
    await this.access.exportDocument(
      document,
      actor,
      'esign.export.create',
      manager,
    );

    const reusable = await this.jobs.reusable(documentId, manager);
    if (reusable) return { job: reusable, reused: true };

    const snapshot = await this.createExportSnapshot(documentId, manager);
    const job = this.createPendingExportJob(
      documentId,
      actor,
      snapshot,
      manager,
    );
    return { job: await this.jobs.save(job, manager), reused: false };
  }

  /** 固定此次匯出的簽署人與完成檔 metadata，尚未產製的副本保留為等待項目。 */
  private async createExportSnapshot(
    documentId: number,
    manager: EntityManager,
  ): Promise<ExportSnapshotEntry[]> {
    const records = await this.jobs.records(documentId, manager);
    if (!records.length)
      throw new AppException(...AppErrors.ESIGN_EXPORT_EMPTY);

    const ready = await this.files.findCompletedFiles(
      records.map((record) => record.id),
      manager,
    );
    const readyByRecord = new Map(
      ready.map((file) => [file.signatureRecordId, file]),
    );

    return records.map((record) => {
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
  }

  /** 以不可變快照初始化等待 worker 處理的 ZIP 匯出工作。 */
  private createPendingExportJob(
    documentId: number,
    actor: Actor,
    snapshot: ExportSnapshotEntry[],
    manager: EntityManager,
  ): EsignExportJob {
    return this.jobs.create(
      {
        publicId: randomUUID(),
        documentId,
        createdByActorKind: actor.kind,
        createdByUserId: actor.kind === 'employee' ? actor.userId : null,
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
        waitingCount: snapshot.filter((entry) => !entry.file).length,
        attemptCount: 0,
      },
      manager,
    );
  }

  /** 已完成工作先確認成果仍可用；等待中的工作則確保已送入 queue。 */
  private async ensureAvailableOrEnqueue(job: EsignExportJob): Promise<void> {
    if (job.completedAt || ['completed', 'expired'].includes(job.status))
      await this.assertAvailable(job);
    if (['pending', 'waiting'].includes(job.status)) await this.enqueue(job.id);
  }

  async detail(documentId: number, publicId: string, actor: Actor) {
    return this.view(await this.find(documentId, publicId, actor));
  }

  async find(documentId: number, publicId: string, actor: Actor) {
    const manager = this.mysql.getManager();
    await this.access.exportDocument(
      await this.documents.findById(documentId, manager),
      actor,
      'esign.export.read',
      manager,
    );
    const job = await this.jobs.find(publicId, documentId, manager);
    if (!job?.snapshotJson)
      throw new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
    return job;
  }

  async retry(documentId: number, publicId: string, actor: Actor) {
    const job = await this.mysql.transaction(async (manager) => {
      await this.authorization.requirePermissions(
        actor,
        ['esign.export.create'],
        manager,
      );
      await this.access.exportDocument(
        await this.documents.findByIdForUpdate(documentId, manager),
        actor,
        'esign.export.create',
        manager,
      );

      const original = await this.jobs.find(
        publicId,
        documentId,
        manager,
        true,
      );
      if (!original?.snapshotJson)
        throw new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);

      const other = await this.jobs.reusable(documentId, manager);

      if (
        other &&
        (other.completedAt ||
          ['completed', 'expired'].includes(other.status) ||
          (other.id !== original.id && other.status !== 'failed'))
      )
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
      return this.jobs.save(original, manager);
    }, 'READ COMMITTED');
    await this.ensureAvailableOrEnqueue(job);
    return this.view(job);
  }

  async listDocuments(q: ExportQueryDto, actor: Actor) {
    const manager = this.mysql.getManager();
    const department = await this.access.exportScope(
      actor,
      'esign.export.read',
      manager,
    );
    const rows = await this.jobs.documents(q, department, manager);
    const more = rows.length > q.limit;
    const selected = rows.slice(0, q.limit);
    const items = await Promise.all(
      selected.map(async (doc) => ({
        documentId: String(doc.id),
        title: doc.title,
        creatorName:
          doc.createdByActorKind === 'super_user'
            ? 'Super user'
            : (doc.createdByUser?.name ?? ''),
        status: doc.status,
        signedCount: await this.jobs.signedCount(doc.id, manager),
        latestExportSummary: await this.summary(
          await this.jobs.latest(doc.id, manager),
        ),
      })),
    );
    return {
      items,
      nextCursor: more ? String(selected[selected.length - 1].id) : null,
    };
  }

  async view(job: EsignExportJob): Promise<ExportJobViewDto> {
    const files = await this.jobs.files(job.id, this.mysql.getManager());
    const display = await this.jobs.displayRecord(
      job.id,
      this.mysql.getManager(),
    );
    return {
      exportedBy: exportActorView(display ?? job),
      id: job.publicId!,
      documentId: String(job.documentId),
      status: job.status,
      snapshotAt: job.snapshotAt?.toISOString() ?? null,
      expectedCount: Number(job.recordCount ?? 0),
      processedCount: job.processedCount ?? 0,
      waitingCount: job.waitingCount ?? 0,
      completedAt: job.completedAt?.toISOString() ?? null,
      expiresAt: null,
      failureCode: job.failureCode ?? null,
      files:
        job.status === 'completed' && job.completedAt !== null
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

  async documentSummary(documentId: number, actor: Actor) {
    const manager = this.mysql.getManager();
    const document = await this.documents.findById(documentId, manager);
    await this.access.exportDocument(
      document,
      actor,
      'esign.export.read',
      manager,
    );
    return this.summary(
      await this.jobs.latest(documentId, this.mysql.getManager()),
    );
  }

  async summary(job: EsignExportJob | null) {
    return job ? this.view(job) : null;
  }

  async download(
    documentId: number,
    publicId: string,
    fileId: number,
    actor: Actor,
  ) {
    const job = await this.find(documentId, publicId, actor);
    const files = await this.jobs.files(job.id, this.mysql.getManager());
    const file = files.find((f) => f.id === fileId);
    if (!file) throw new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
    if (job.completedAt || ['completed', 'expired'].includes(job.status))
      await this.assertAvailable(job);
    if (job.status !== 'completed')
      throw new AppException(...AppErrors.ESIGN_EXPORT_NOT_READY);
    return file;
  }

  async assertAvailable(job: EsignExportJob) {
    try {
      if (job.status !== 'completed' || !job.completedAt)
        throw new Error('原匯出成果不可用');
      const files = await this.jobs.files(job.id, this.mysql.getManager());
      if (files.some((file) => file.archiveStatus !== 'active'))
        throw new Error('匯出成果未啟用');
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
