import { Injectable } from '@nestjs/common';
import { type DeepPartial, type EntityManager, In } from 'typeorm';
import { EsignDocument } from '../entities/esign-document.entity';
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
    // 與停止、簽署及 audit 一致，先鎖 document，避免反向鎖定。
    await this.lockDocument(candidate.signer.documentId, manager);
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
    afterId = 0,
  ) {
    return manager
      .createQueryBuilder(EsignNotificationLog, 'log')
      .innerJoin('log.signer', 'signer')
      .innerJoin('signer.document', 'document')
      .select('log.id', 'id')
      .where(
        "((log.result IN ('pending','failed') AND (log.next_attempt_at IS NULL OR log.next_attempt_at <= :now)) OR (log.result = 'processing' AND log.processing_started_at < :staleBefore))",
        { now, staleBefore },
      )
      .andWhere("signer.status = 'pending' AND document.status = 'active'")
      .andWhere('signer.invitation_token_ciphertext IS NOT NULL')
      .andWhere(
        'signer.invitation_expires_at > :now AND document.sign_end_at > :now',
        { now },
      )
      .andWhere('log.id > :afterId', { afterId })
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
