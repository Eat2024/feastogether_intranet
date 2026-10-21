import { EsignSigner } from '../entities/esign-signer.entity';
import { Injectable } from '@nestjs/common';
import { type DeepPartial, type EntityManager, In } from 'typeorm';
import { EsignDocument } from '../entities/esign-document.entity';
import { EsignNotificationBatch } from '../entities/esign-notification-batch.entity';
import { EsignNotificationLog } from '../entities/esign-notification-log.entity';

@Injectable()
export class NotificationRepository {
  listBatches(
    documentId: number,
    manager: EntityManager,
    limit: number,
    cursor?: string,
    kind?: string,
  ) {
    const query = manager
      .createQueryBuilder(EsignNotificationBatch, 'batch')
      .leftJoinAndSelect('batch.notifiedByUser', 'user')
      .where('batch.documentId = :documentId', { documentId });
    if (cursor) query.andWhere('batch.id < :cursor', { cursor });
    if (kind) query.andWhere('batch.kind = :kind', { kind });
    return query
      .orderBy('batch.id', 'DESC')
      .take(limit + 1)
      .getMany();
  }
  pageBatchLogs(
    batchId: number,
    manager: EntityManager,
    limit: number,
    cursor?: string,
  ) {
    const query = manager
      .createQueryBuilder(EsignNotificationLog, 'log')
      .leftJoinAndSelect('log.signer', 'signer')
      .where('log.batchId = :batchId', { batchId });
    if (cursor) query.andWhere('log.id > :cursor', { cursor });
    return query
      .orderBy('log.id', 'ASC')
      .take(limit + 1)
      .getMany();
  }
  async batchCounts(batchId: number, manager: EntityManager) {
    const status =
      "CASE WHEN log.result = 'failed' AND log.next_attempt_at IS NOT NULL THEN 'pending' ELSE log.result END";
    const rows = await manager
      .createQueryBuilder(EsignNotificationLog, 'log')
      .select(status, 'status')
      .addSelect('COUNT(*)', 'count')
      .where('log.batchId = :batchId', { batchId })
      .groupBy(status)
      .getRawMany<{ status: string; count: string }>();
    return Object.fromEntries(
      rows.map((row) => [row.status, Number(row.count)]),
    );
  }

  findBatchRequest(
    documentId: number,
    notifiedByUserId: number,
    requestId: string,
    manager: EntityManager,
  ) {
    return manager.findOne(EsignNotificationBatch, {
      where: { documentId, notifiedByUserId, requestId },
    });
  }
  findBatchPublic(
    documentId: number,
    publicId: string,
    manager: EntityManager,
  ) {
    return manager.findOne(EsignNotificationBatch, {
      where: { documentId, publicId },
      relations: { notifiedByUser: true },
    });
  }
  findBatchLogs(batchId: number, manager: EntityManager) {
    return manager.find(EsignNotificationLog, {
      where: { batchId },
      relations: { signer: true },
      order: { id: 'ASC' },
    });
  }
  findReminderDigest(reminderTokenSha256: string, manager: EntityManager) {
    return manager.findOne(EsignNotificationLog, {
      where: { reminderTokenSha256 },
      relations: { signer: true },
    });
  }

  createBatch(
    fields: DeepPartial<EsignNotificationBatch>,
    manager: EntityManager,
  ) {
    return manager.create(EsignNotificationBatch, fields);
  }

  saveBatch(batch: EsignNotificationBatch, manager: EntityManager) {
    return manager.save(batch);
  }

  createLog(fields: DeepPartial<EsignNotificationLog>, manager: EntityManager) {
    return manager.create(EsignNotificationLog, fields);
  }

  saveLogs(logs: EsignNotificationLog[], manager: EntityManager) {
    return manager.save(logs);
  }

  findLogById(id: number, manager: EntityManager) {
    return manager.findOne(EsignNotificationLog, { where: { id } });
  }

  findLogByIdForUpdate(id: number, manager: EntityManager) {
    return manager.findOne(EsignNotificationLog, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
  }

  lockDocument(id: number, manager: EntityManager) {
    return manager.findOne(EsignDocument, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
  }

  async findInvitationContextForUpdate(id: number, manager: EntityManager) {
    const candidate = await manager.findOne(EsignNotificationLog, {
      where: { id },
      relations: { signer: true },
    });
    if (!candidate?.signer) return null;
    // 明確依 document → log → signer 鎖定，避免 joined lock 讓 MySQL 自選鎖序。
    const document = await this.lockDocument(
      candidate.signer.documentId,
      manager,
    );
    if (!document) return null;
    const log = await this.findLogByIdForUpdate(id, manager);
    if (!log) return null;
    const signer = await manager.findOne(EsignSigner, {
      where: { id: candidate.signerId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!signer) return null;
    const documentWithCreator =
      (await manager.findOne(EsignDocument, {
        where: { id: document.id },
        relations: { createdByUser: true },
      })) ?? undefined;
    document.createdByUser = documentWithCreator?.createdByUser;
    signer.document = document;
    log.signer = signer;
    log.batch =
      (await manager.findOne(EsignNotificationBatch, {
        where: { id: log.batchId },
      })) ?? undefined;
    return log;
  }

  saveLog(log: EsignNotificationLog, manager: EntityManager) {
    return manager.save(log);
  }

  findByDocumentForUpdate(documentId: number, manager: EntityManager) {
    return (
      manager
        .createQueryBuilder(EsignNotificationLog, 'log')
        // 只鎖通知列，不讓 JOIN 預先鎖 signer；包含催簽的舊世代。
        .where(
          'log.batch_id IN (SELECT id FROM esign_notification_batches WHERE document_id = :documentId)',
          { documentId },
        )
        .orderBy('log.id', 'ASC')
        .setLock('pessimistic_write')
        .getMany()
    );
  }

  findEligibleInvitationLogIds(
    now: Date,
    staleBefore: Date,
    manager: EntityManager,
    afterId = 0,
  ) {
    return manager
      .createQueryBuilder(EsignNotificationLog, 'log')
      .innerJoin('log.batch', 'batch')
      .innerJoin('log.signer', 'signer')
      .innerJoin('signer.document', 'document')
      .select('log.id', 'id')
      .where(
        `(
        (batch.kind = 'reminder' AND (
          (log.result IN ('pending','failed') AND log.attempt_count < 3 AND log.reminder_token_ciphertext IS NOT NULL AND (log.next_attempt_at IS NULL OR log.next_attempt_at <= :now))
          OR (log.result = 'processing' AND log.processing_started_at < :staleBefore)))
        OR (batch.kind = 'invitation' AND
          ((log.result IN ('pending','failed') AND (log.next_attempt_at IS NULL OR log.next_attempt_at <= :now)) OR (log.result = 'processing' AND log.processing_started_at < :staleBefore))
          AND signer.status = 'pending' AND document.status = 'active'
          AND log.invitation_generation_sha256 = signer.invitation_token_sha256
          AND signer.invitation_token_ciphertext IS NOT NULL AND signer.invitation_expires_at > :now AND document.sign_end_at > :now)
        )`,
        { now, staleBefore },
      )
      .andWhere('(log.error_code IS NULL OR log.error_code <> :superseded)', {
        superseded: 'INVITATION_SUPERSEDED',
      })
      .andWhere('log.id > :afterId', { afterId })
      .orderBy('log.id', 'ASC')
      .limit(100)
      .getRawMany<{ id: string }>();
  }

  findBySignerIds(signerIds: number[], manager: EntityManager) {
    if (signerIds.length === 0) return Promise.resolve([]);
    return manager.find(EsignNotificationLog, {
      where: { signerId: In(signerIds) },
      relations: { batch: true },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  }
}
