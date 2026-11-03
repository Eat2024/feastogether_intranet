import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { type DeepPartial, type EntityManager } from 'typeorm';
import {
  EsignInitiationJob,
  type InitiationDocumentVersion,
} from '../entities/esign-initiation-job.entity';
import { EsignDocument } from '../entities/esign-document.entity';
import { EsignFileObject } from '../entities/esign-file-object.entity';

/** 正式 worker 的狹窄通行權，不能由 HTTP request 指定。 */
export interface InitiationLease {
  jobId: number;
  leaseToken: string;
  expectedEmployees?: ReadonlyMap<number, string>;
}

@Injectable()
export class InitiationJobRepository {
  byId(id: number, manager: EntityManager, lock = false, input = false) {
    const query = manager
      .createQueryBuilder(EsignInitiationJob, 'job')
      .where('job.id = :id', { id });
    if (input)
      query.addSelect([
        'job.inputJson',
        'job.documentVersionJson',
        'job.issuesJson',
      ]);
    if (lock) query.setLock('pessimistic_write');
    return query.getOne();
  }

  find(documentId: number, publicId: string, manager: EntityManager) {
    return manager.findOneBy(EsignInitiationJob, { documentId, publicId });
  }

  /** 最新以資料庫流水號判斷；摘要查詢不載入大型輸入與問題 JSON。 */
  latest(documentId: number, manager: EntityManager) {
    return manager.findOne(EsignInitiationJob, {
      where: { documentId },
      order: { id: 'DESC' },
    });
  }

  byKey(documentId: number, requestKey: string, manager: EntityManager) {
    // 呼叫端先取得文件鎖，這裡必須 current read，不能讀 RR 舊快照。
    return manager
      .createQueryBuilder(EsignInitiationJob, 'job')
      .where('job.documentId = :documentId AND job.requestKey = :requestKey', {
        documentId,
        requestKey,
      })
      .setLock('pessimistic_write')
      .getOne();
  }

  active(documentId: number, manager: EntityManager) {
    return manager
      .createQueryBuilder(EsignInitiationJob, 'job')
      .where('job.activeDocumentId = :documentId', { documentId })
      .addSelect('job.documentVersionJson')
      .setLock('pessimistic_write')
      .getOne();
  }

  create(fields: DeepPartial<EsignInitiationJob>, manager: EntityManager) {
    return manager.save(manager.create(EsignInitiationJob, fields));
  }

  save(job: EsignInitiationJob, manager: EntityManager) {
    return manager.save(job);
  }

  async version(
    documentId: number,
    manager: EntityManager,
  ): Promise<InitiationDocumentVersion | null> {
    const document = await manager
      .createQueryBuilder(EsignDocument, 'document')
      .select(
        "DATE_FORMAT(document.updated_at, '%Y-%m-%d %H:%i:%s.%f')",
        'updatedAt',
      )
      .where('document.id = :documentId', { documentId })
      .setLock('pessimistic_read')
      .getRawOne<{ updatedAt: string }>();
    const source = await manager
      .createQueryBuilder(EsignFileObject, 'source')
      .where(
        'source.documentId = :documentId AND source.filePurpose = :purpose AND source.archiveStatus = :archive',
        { documentId, purpose: 'source_pdf', archive: 'active' },
      )
      .setLock('pessimistic_read')
      .getOne();
    if (!document || !source) return null;
    return {
      updatedAt: document.updatedAt,
      sourceFileId: source.id,
      sourceSha256: source.sha256,
      sourceObjectVersion: source.objectVersion ?? null,
    };
  }

  async claim(
    id: number,
    manager: EntityManager,
  ): Promise<EsignInitiationJob | null> {
    const job = await this.byId(id, manager, true, true);
    const now = new Date();
    if (
      !job ||
      job.status !== 'queued' ||
      job.attemptCount >= 3 ||
      (job.nextAttemptAt && job.nextAttemptAt > now)
    )
      return null;
    if (job.deadlineAt <= now) {
      job.status = 'failed';
      job.stage = 'failed';
      job.completedAt = now;
      job.errorCode = 'ESIGN_INITIATION_PROCESSING_TIMEOUT';
      job.retryable = true;
      await this.save(job, manager);
      return null;
    }
    job.status = 'processing';
    job.stage = 'resolving';
    job.attemptCount += 1;
    job.processedCount = 0;
    job.leaseToken = randomUUID();
    job.leaseExpiresAt = new Date(now.getTime() + 300000);
    job.startedAt ??= now;
    job.lastProgressAt = now;
    job.nextAttemptAt = null;
    await this.save(job, manager);
    return this.byId(id, manager, true, true);
  }

  /** 每個 attempt 的查核數；只有有效 lease 可提交供摘要讀取的階段。 */
  async progress(
    lease: InitiationLease,
    stage: 'resolving' | 'validating' | 'committing',
    processedCount: number,
    manager: EntityManager,
  ): Promise<boolean> {
    const result = await manager
      .createQueryBuilder()
      .update(EsignInitiationJob)
      .set({ stage, processedCount, lastProgressAt: new Date() })
      .where(
        'id = :id AND status = :status AND lease_token = :token AND lease_expires_at > UTC_TIMESTAMP(6) AND deadline_at > UTC_TIMESTAMP(6) AND processed_count <= :count AND total_count >= :count',
        {
          id: lease.jobId,
          status: 'processing',
          token: lease.leaseToken,
          count: processedCount,
        },
      )
      .execute();
    return result.affected === 1;
  }

  async fail(
    lease: InitiationLease,
    errorCode: string,
    manager: EntityManager,
  ): Promise<void> {
    // CAS 是工作擁有權邊界；updated_at 由 QueryBuilder 的 UpdateDateColumn 維護。
    await manager
      .createQueryBuilder()
      .update(EsignInitiationJob)
      .set({
        status: 'failed',
        stage: 'failed',
        errorCode,
        completedAt: new Date(),
        leaseToken: null,
        leaseExpiresAt: null,
        retryable: false,
      })
      .where(
        'id = :id AND status = :status AND lease_token = :token AND lease_expires_at > UTC_TIMESTAMP(6)',
        { id: lease.jobId, status: 'processing', token: lease.leaseToken },
      )
      .execute();
  }
}
