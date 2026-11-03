import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { type DeepPartial, type EntityManager } from 'typeorm';
import {
  EsignInitiationJob,
  type InitiationDocumentVersion,
  type InitiationIssue,
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

  find(
    documentId: number,
    publicId: string,
    manager: EntityManager,
    detail?: 'inputJson' | 'issuesJson',
    lock = false,
  ) {
    const query = manager
      .createQueryBuilder(EsignInitiationJob, 'job')
      .where('job.documentId = :documentId AND job.publicId = :publicId', {
        documentId,
        publicId,
      });
    if (detail) query.addSelect(`job.${detail}`);
    if (lock) query.setLock('pessimistic_write');
    return query.getOne();
  }

  /** 最新以資料庫流水號判斷；摘要查詢不載入大型輸入與問題 JSON。 */
  latest(documentId: number, manager: EntityManager, lock = false) {
    return manager.findOne(EsignInitiationJob, {
      where: { documentId },
      order: { id: 'DESC' },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
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
      this.failureState(job, now, this.deadlineCode(job), false);
      await this.save(job, manager);
      return null;
    }
    job.status = 'processing';
    job.stage = 'resolving';
    job.attemptCount += 1;
    job.processedCount = 0;
    job.leaseToken = randomUUID();
    job.leaseExpiresAt = new Date(now.getTime() + 300000);
    job.errorCode = null;
    job.retryable = false;
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

  /** 僅取得可立即鎖定的工作，不與正式交易互相等待。 */
  async recover(
    now: Date,
    afterId: number,
    manager: EntityManager,
  ): Promise<EsignInitiationJob[]> {
    const jobs = await manager
      .createQueryBuilder(EsignInitiationJob, 'job')
      .where('job.id > :afterId', { afterId })
      .andWhere(
        `((job.status = 'queued' AND (job.next_attempt_at IS NULL OR job.next_attempt_at <= :now OR job.deadline_at <= :now)) OR (job.status = 'processing' AND (job.lease_expires_at <= :now OR job.deadline_at <= :now)))`,
        { now },
      )
      .orderBy('job.id', 'ASC')
      .take(100)
      .setLock('pessimistic_write')
      .setOnLocked('skip_locked')
      .getMany();
    for (const job of jobs) {
      if (
        job.deadlineAt <= now ||
        job.status === 'processing' ||
        job.attemptCount >= 3
      ) {
        this.failureState(job, now, 'ESIGN_INITIATION_TRANSIENT_FAILURE', true);
        await this.save(job, manager);
      }
    }
    return jobs;
  }

  /** 僅鎖終態小欄位；被 retry 持有的 parent 留待下輪，不能反向鎖文件。 */
  async purgeInputs(
    now: Date,
    afterId: number,
    manager: EntityManager,
  ): Promise<number[]> {
    const cutoff = new Date(now.getTime() - 30 * 86400000);
    const jobs = await manager
      .createQueryBuilder(EsignInitiationJob, 'job')
      .select('job.id')
      .where('job.id > :afterId', { afterId })
      .andWhere('job.status IN (:...statuses)', {
        statuses: ['succeeded', 'failed'],
      })
      .andWhere('job.completed_at <= :cutoff AND job.input_purged_at IS NULL', {
        cutoff,
      })
      .orderBy('job.id', 'ASC')
      .take(100)
      .setLock('pessimistic_write')
      .setOnLocked('skip_locked')
      .getMany();
    const ids = jobs.map((job) => job.id);
    if (!ids.length) return [];
    // 此為明細保留清理，非業務狀態轉移；窄 UPDATE 避免 save 自動改寫摘要 updated_at。
    // 同一交易已取得 current-read job 鎖，僅清三個 JSON 並另記清理時間，保留原微秒時間。
    await manager
      .createQueryBuilder()
      .update(EsignInitiationJob)
      .set({
        inputJson: null,
        documentVersionJson: null,
        issuesJson: null,
        inputPurgedAt: now,
        updatedAt: () => 'updated_at',
      })
      .whereInIds(ids)
      .execute();
    return ids;
  }

  /** 續租與查核批次獨立；失去租約或期限到即停止，不重新取得所有權。 */
  async renew(
    lease: InitiationLease,
    manager: EntityManager,
  ): Promise<boolean> {
    return this.heartbeat(lease, true, manager);
  }

  async heartbeat(
    lease: InitiationLease,
    renew: boolean,
    manager: EntityManager,
  ): Promise<boolean> {
    const now = new Date();
    const result = await manager
      .createQueryBuilder()
      .update(EsignInitiationJob)
      .set(
        renew
          ? {
              leaseExpiresAt: new Date(now.getTime() + 300000),
              lastProgressAt: now,
            }
          : { lastProgressAt: now },
      )
      .where(
        'id = :id AND status = :status AND lease_token = :token AND lease_expires_at > UTC_TIMESTAMP(6) AND deadline_at > UTC_TIMESTAMP(6)',
        { id: lease.jobId, status: 'processing', token: lease.leaseToken },
      )
      .execute();
    return result.affected === 1;
  }

  /** 失敗處理使用短 job 鎖；持有者與期限在 current read 後重新確認。 */
  async fail(
    lease: InitiationLease,
    errorCode: string,
    transient: boolean,
    manager: EntityManager,
    issues: InitiationIssue[] = [],
  ): Promise<EsignInitiationJob | null> {
    const job = await this.byId(lease.jobId, manager, true);
    const now = new Date();
    if (
      !job ||
      job.status !== 'processing' ||
      job.leaseToken !== lease.leaseToken ||
      !job.leaseExpiresAt ||
      job.leaseExpiresAt <= now
    )
      return null;
    this.failureState(job, now, errorCode, transient);
    job.issuesJson = job.completedAt ? issues : [];
    job.issueCount = job.issuesJson.length;
    return this.save(job, manager);
  }

  private failureState(
    job: EsignInitiationJob,
    now: Date,
    code: string,
    transient: boolean,
  ): void {
    const expired = job.deadlineAt <= now;
    job.leaseToken = null;
    job.leaseExpiresAt = null;
    job.lastProgressAt = now;
    if (!expired && transient && job.attemptCount < 3) {
      job.status = 'queued';
      job.stage = 'queued';
      job.nextAttemptAt = new Date(
        now.getTime() + (job.attemptCount === 1 ? 30000 : 120000),
      );
      job.errorCode = 'ESIGN_INITIATION_TRANSIENT_FAILURE';
      job.retryable = false;
      return;
    }
    job.status = 'failed';
    job.stage = 'failed';
    job.completedAt = now;
    job.nextAttemptAt = null;
    job.errorCode = expired ? this.deadlineCode(job) : code;
    job.retryable =
      job.errorCode === 'ESIGN_INITIATION_TRANSIENT_FAILURE' ||
      job.errorCode === 'ESIGN_INITIATION_PROCESSING_TIMEOUT';
  }

  private deadlineCode(job: EsignInitiationJob): string {
    return job.deadlineAt.getTime() < job.acceptedAt.getTime() + 7200000
      ? 'ESIGN_INITIATION_DEADLINE_PASSED'
      : 'ESIGN_INITIATION_PROCESSING_TIMEOUT';
  }
}
