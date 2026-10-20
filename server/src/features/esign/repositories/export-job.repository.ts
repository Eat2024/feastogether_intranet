import { Injectable } from '@nestjs/common';
import { type EntityManager, IsNull, In } from 'typeorm';
import { EsignExportJob } from '../entities/esign-export-job.entity';
import { EsignFileObject } from '../entities/esign-file-object.entity';
import { EsignDocument } from '../entities/esign-document.entity';
import { EsignSignatureRecord } from '../entities/esign-signature-record.entity';

@Injectable()
export class ExportJobRepository {
  find(publicId: string, documentId: number, m: EntityManager, lock = false) {
    return m.findOne(EsignExportJob, {
      where: { publicId, documentId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
  }
  byId(id: number, m: EntityManager, lock = false) {
    return m.findOne(EsignExportJob, {
      where: { id },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
  }
  reusable(documentId: number, now: Date, m: EntityManager) {
    return m
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
  records(documentId: number, m: EntityManager) {
    return (
      m
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
  files(jobId: number, m: EntityManager) {
    return m.find(EsignFileObject, {
      where: { exportJobId: jobId, filePurpose: 'signed_copies_zip' },
    });
  }
  save(job: EsignExportJob, m: EntityManager) {
    return m.save(job);
  }
  create(fields: Partial<EsignExportJob>, m: EntityManager) {
    return m.create(EsignExportJob, fields);
  }
  documents(
    q: { cursor?: string; limit: number; status?: string; q?: string },
    m: EntityManager,
  ) {
    const query = m
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
  latest(documentId: number, m: EntityManager) {
    return m.findOne(EsignExportJob, {
      where: { documentId, exportType: 'signed_copies_zip' },
      order: { id: 'DESC' },
    });
  }
  history(
    q: { documentId?: number; cursor?: string; limit: number },
    m: EntityManager,
  ) {
    const query = m
      .createQueryBuilder(EsignExportJob, 'job')
      .innerJoin(
        EsignDocument,
        'document',
        'document.id=job.documentId AND document.deletedAt IS NULL',
      )
      .leftJoinAndSelect('job.createdByUser', 'creator')
      .where(
        "job.snapshotJson IS NOT NULL AND job.exportType = 'signed_copies_zip'",
      );
    if (q.documentId)
      query.andWhere('job.documentId=:documentId', {
        documentId: q.documentId,
      });
    if (q.cursor)
      query.andWhere('job.id < :cursor', { cursor: Number(q.cursor) });
    return query
      .orderBy('job.id', 'DESC')
      .take(q.limit + 1)
      .getMany();
  }
  signedCount(documentId: number, m: EntityManager) {
    return m
      .createQueryBuilder(EsignSignatureRecord, 'record')
      .innerJoin('record.signer', 'signer')
      .where('signer.documentId=:documentId', { documentId })
      .andWhere("signer.status='signed' AND signer.deletedAt IS NULL")
      .getCount();
  }
  maintenance(now: Date, m: EntityManager) {
    return m
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
  snapshotRecords(ids: number[], m: EntityManager) {
    return m.find(EsignSignatureRecord, {
      where: { id: In(ids) },
      relations: { signer: true },
    });
  }
  async isReferenced(objectKey: string, m: EntityManager, now = new Date()) {
    if (
      await m.exists(EsignFileObject, {
        where: { objectKey, archiveStatus: 'active' },
      })
    )
      return true;
    return m
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
  async archiveFile(id: number, m: EntityManager) {
    const file = await m.findOneBy(EsignFileObject, { id });
    if (file) {
      file.archiveStatus = 'expired';
      await m.save(file);
    }
  }
  documentExists(id: number, m: EntityManager) {
    return m.findOneBy(EsignDocument, { id, deletedAt: IsNull() });
  }
}
