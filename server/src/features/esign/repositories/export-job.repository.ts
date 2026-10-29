import { Injectable } from '@nestjs/common';
import { type EntityManager, IsNull, In } from 'typeorm';
import {
  EsignExportJob,
  type EsignExportType,
  EXPORT_TYPE_COLUMN,
} from '../entities/esign-export-job.entity';
import { EsignFileObject } from '../entities/esign-file-object.entity';
import { EsignDocument } from '../entities/esign-document.entity';
import { EsignSignatureRecord } from '../entities/esign-signature-record.entity';

@Injectable()
export class ExportJobRepository {
  find(
    publicId: string,
    documentId: number,
    manager: EntityManager,
    lock = false,
  ) {
    return manager.findOne(EsignExportJob, {
      where: { publicId, documentId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
  }
  byId(id: number, manager: EntityManager, lock = false) {
    return manager.findOne(EsignExportJob, {
      where: { id },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
  }
  reusable(documentId: number, now: Date, manager: EntityManager) {
    return manager
      .createQueryBuilder(EsignExportJob, 'job')
      .where('job.documentId = :documentId', { documentId })
      .andWhere(
        "job.exportType = 'signed_copies_zip' AND job.snapshotJson IS NOT NULL",
      )
      .andWhere(
        "((job.status = 'completed' AND job.expiresAt > :now) OR job.status IN ('pending','waiting','processing','failed'))",
        { now },
      )
      .orderBy(
        "CASE WHEN job.status = 'completed' THEN 0 WHEN job.status = 'failed' THEN 2 ELSE 1 END",
        'ASC',
      )
      .addOrderBy('job.id', 'DESC')
      .getOne();
  }
  records(documentId: number, manager: EntityManager) {
    return (
      manager
        .createQueryBuilder(EsignSignatureRecord, 'record')
        .innerJoinAndSelect('record.signer', 'signer')
        // 匯出快照僅需識別與檔名；避免 6,000 份完整簽署證據/個資 entity 佔用 API 記憶體。
        .select([
          'record.id',
          'record.signerId',
          'signer.id',
          'signer.publicId',
          'signer.nameSnapshot',
        ])
        .where('signer.documentId = :documentId', { documentId })
        .andWhere("signer.status = 'signed' AND signer.deletedAt IS NULL")
        .orderBy('record.id', 'ASC')
        .getMany()
    );
  }
  files(jobId: number, manager: EntityManager) {
    return manager.find(EsignFileObject, {
      where: { exportJobId: jobId, filePurpose: 'signed_copies_zip' },
    });
  }
  save(job: EsignExportJob, manager: EntityManager) {
    return manager.save(job);
  }
  create(fields: Partial<EsignExportJob>, manager: EntityManager) {
    return manager.create(EsignExportJob, fields);
  }
  documents(
    q: { cursor?: string; limit: number; status?: string; q?: string },
    manager: EntityManager,
  ) {
    const query = manager
      .createQueryBuilder(EsignDocument, 'document')
      .leftJoinAndSelect('document.createdByUser', 'creator')
      .where('document.deletedAt IS NULL');
    if (q.cursor)
      query.andWhere('document.id < :cursor', { cursor: Number(q.cursor) });
    if (q.status)
      query.andWhere('document.status = :status', { status: q.status });
    if (q.q) query.andWhere('document.title LIKE :q', { q: `%${q.q}%` });
    return query
      .orderBy('document.id', 'DESC')
      .take(q.limit + 1)
      .getMany();
  }
  latest(documentId: number, manager: EntityManager) {
    return manager.findOne(EsignExportJob, {
      where: { documentId, exportType: 'signed_copies_zip' },
      order: { id: 'DESC' },
    });
  }
  /** 依匯出時間、流水號由新到舊列出一頁紀錄，帶出文件、匯出員工與簽署人。 */
  historyPage(
    q: {
      exportType: EsignExportType;
      documentId?: number;
      offset: number;
      limit: number;
    },
    manager: EntityManager,
  ) {
    return this.historyRecordsQuery(q.documentId, manager)
      .andWhere('job.exportType = :exportType', { exportType: q.exportType })
      .orderBy('job.createdAt', 'DESC')
      .addOrderBy('job.id', 'DESC')
      .offset(q.offset)
      .limit(q.limit)
      .getMany();
  }

  /** 依紀錄 UUID 讀取指定類型的一筆紀錄，欄位與條件同 historyPage；類型不符視為不存在。 */
  historyRecord(
    publicId: string,
    exportType: EsignExportType,
    manager: EntityManager,
  ) {
    return this.historyRecordsQuery(undefined, manager)
      .andWhere('job.publicId = :publicId', { publicId })
      .andWhere('job.exportType = :exportType', { exportType })
      .getOne();
  }

  /** 依匯出類型分組計數，條件與 historyPage 相同。 */
  async historyCounts(
    exportTypes: EsignExportType[],
    documentId: number | undefined,
    manager: EntityManager,
  ) {
    const rows = await this.visibleHistoryQuery(documentId, manager)
      .andWhere('job.exportType IN (:...exportTypes)', { exportTypes })
      .select('job.exportType', 'exportType')
      .addSelect('COUNT(*)', 'count')
      .groupBy('job.exportType')
      .getRawMany<{ exportType: EsignExportType; count: number | string }>();
    return new Map(rows.map((row) => [row.exportType, Number(row.count)]));
  }

  /** 列表與單筆紀錄共用的查詢：可見的紀錄，帶出文件、匯出員工與簽署人的顯示欄位。 */
  private historyRecordsQuery(
    documentId: number | undefined,
    manager: EntityManager,
  ) {
    return (
      this.visibleHistoryQuery(documentId, manager)
        // 不載入 ZIP 快照與已固定副本清單，單筆可達數千項。
        .select([
          'job.id',
          'job.publicId',
          'job.exportType',
          'job.documentId',
          'job.createdByUserId',
          'job.signerId',
          'job.conditionsJson',
          'job.status',
          'job.scopeDescription',
          'job.recordCount',
          'job.snapshotAt',
          'job.processedCount',
          'job.waitingCount',
          'job.completedAt',
          'job.expiresAt',
          'job.failureCode',
          'job.createdAt',
          'document.id',
          'document.title',
          'document.docNumber',
          'exporter.id',
          'exporter.name',
          'exporter.empid',
          'signer.id',
          'signer.publicId',
          'signer.nameSnapshot',
          'signer.email',
        ])
        .leftJoin('job.createdByUser', 'exporter')
        .leftJoin('job.signer', 'signer')
    );
  }

  /**
   * 可見的歷史紀錄：文件未刪除；ZIP 只計有快照的匯出工作。
   * 匯出員工與簽署人已軟刪除時仍要顯示，因此關閉 join 的自動軟刪除條件，只明確排除已刪除的文件。
   */
  private visibleHistoryQuery(
    documentId: number | undefined,
    manager: EntityManager,
  ) {
    const query = manager
      .createQueryBuilder(EsignExportJob, 'job')
      .withDeleted()
      .innerJoin('job.document', 'document', 'document.deletedAt IS NULL')
      .where('(job.exportType <> :zipType OR job.snapshotJson IS NOT NULL)', {
        zipType: EXPORT_TYPE_COLUMN.zip,
      });
    if (documentId)
      query.andWhere('job.documentId = :documentId', { documentId });
    return query;
  }
  signedCount(documentId: number, manager: EntityManager) {
    return manager
      .createQueryBuilder(EsignSignatureRecord, 'record')
      .innerJoin('record.signer', 'signer')
      .where('signer.documentId=:documentId', { documentId })
      .andWhere("signer.status='signed' AND signer.deletedAt IS NULL")
      .getCount();
  }
  maintenance(now: Date, manager: EntityManager) {
    return manager
      .createQueryBuilder(EsignExportJob, 'job')
      .where('job.snapshotJson IS NOT NULL')
      .andWhere(
        "((job.status IN ('pending','waiting') AND (job.nextAttemptAt IS NULL OR job.nextAttemptAt <= :now)) OR (job.status='processing' AND job.leaseExpiresAt <= :now) OR (job.status='completed' AND job.expiresAt <= :now) OR (job.status='expired' AND EXISTS (SELECT 1 FROM esign_file_objects f WHERE f.export_job_id=job.id AND f.archive_status='active')))",
        { now },
      )
      .orderBy('job.updatedAt', 'ASC')
      .take(50)
      .getMany();
  }
  snapshotRecords(ids: number[], manager: EntityManager) {
    return manager.find(EsignSignatureRecord, {
      where: { id: In(ids) },
      relations: { signer: true },
    });
  }
  async isReferenced(
    objectKey: string,
    manager: EntityManager,
    now = new Date(),
  ) {
    if (
      await manager.exists(EsignFileObject, {
        where: { objectKey, archiveStatus: 'active' },
      })
    )
      return true;
    return manager
      .createQueryBuilder(EsignExportJob, 'job')
      .where(
        "JSON_UNQUOTE(JSON_EXTRACT(job.stagingJson, '$.objectKey')) = :objectKey",
        { objectKey },
      )
      .andWhere("job.status = 'processing' AND job.leaseExpiresAt > :now", {
        now,
      })
      .andWhere(
        "JSON_UNQUOTE(JSON_EXTRACT(job.stagingJson, '$.generation')) = job.leaseToken",
      )
      .getExists();
  }
  async archiveFile(id: number, manager: EntityManager) {
    const file = await manager.findOneBy(EsignFileObject, { id });
    if (file) {
      file.archiveStatus = 'expired';
      await manager.save(file);
    }
  }
  documentExists(id: number, manager: EntityManager) {
    return manager.findOneBy(EsignDocument, { id, deletedAt: IsNull() });
  }
}
