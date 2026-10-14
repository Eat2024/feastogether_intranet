import { Injectable } from '@nestjs/common';
import { type DeepPartial, type EntityManager, In } from 'typeorm';
import { EsignNotificationBatch } from '../entities/esign-notification-batch.entity';
import { EsignNotificationLog } from '../entities/esign-notification-log.entity';

@Injectable()
export class NotificationRepository {
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

  findInvitationContextForUpdate(id: number, manager: EntityManager) {
    return manager.findOne(EsignNotificationLog, {
      where: { id },
      relations: {
        signer: { document: { createdByUser: true } },
      },
      lock: { mode: 'pessimistic_write' },
    });
  }

  saveLog(log: EsignNotificationLog, manager: EntityManager) {
    return manager.save(log);
  }

  findEligibleInvitationLogIds(
    now: Date,
    staleBefore: Date,
    manager: EntityManager,
  ) {
    return manager
      .createQueryBuilder(EsignNotificationLog, 'log')
      .select('log.id', 'id')
      .where(
        "(log.result IN ('pending','failed') AND (log.next_attempt_at IS NULL OR log.next_attempt_at <= :now))",
        { now },
      )
      .orWhere(
        "(log.result = 'processing' AND log.processing_started_at < :staleBefore)",
        { staleBefore },
      )
      .orderBy('log.id', 'ASC')
      .limit(100)
      .getRawMany<{ id: string }>();
  }

  findBySignerIds(signerIds: number[], manager: EntityManager) {
    if (signerIds.length === 0) return Promise.resolve([]);
    return manager.find(EsignNotificationLog, {
      where: { signerId: In(signerIds) },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  }
}
