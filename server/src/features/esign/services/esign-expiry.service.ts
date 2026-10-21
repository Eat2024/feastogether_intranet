import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import type { EsignDocument } from '../entities/esign-document.entity';
import type { EsignSigner } from '../entities/esign-signer.entity';
import { DocumentRepository } from '../repositories/document.repository';
import { SignerRepository } from '../repositories/signer.repository';
import { EsignAuditService } from './esign-audit.service';

@Injectable()
export class EsignExpiryService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly documents: DocumentRepository,
    private readonly signers: SignerRepository,
    private readonly audit: EsignAuditService,
  ) {}

  async reconcile(now = new Date()): Promise<number> {
    let expired = 0;
    let afterId = 0;
    while (true) {
      const rows = await this.documents.findExpiredActiveIds(
        now,
        this.mysql.getManager(),
        afterId,
      );
      if (rows.length === 0) break;
      for (const row of rows) {
        if (await this.expireByDeadline(Number(row.id))) expired += 1;
      }
      afterId = Number(rows[rows.length - 1].id);
    }
    return expired;
  }

  expireByDeadline(documentId: number) {
    return this.mysql.transaction(async (manager) => {
      const document = await this.documents.findByIdForUpdate(
        documentId,
        manager,
      );
      if (!document || document.status !== 'active') return false;
      const signers = await this.signers.findByDocumentForUpdate(
        documentId,
        manager,
      );
      return this.expireLocked(document, signers, new Date(), manager);
    });
  }

  /** 呼叫者須依文件 → 簽署人順序取得鎖；補簽可在同一交易補記尚未落盤的到期。 */
  async expireLocked(
    document: EsignDocument,
    signers: EsignSigner[],
    now: Date,
    manager: EntityManager,
  ): Promise<boolean> {
    if (
      document.status !== 'active' ||
      !document.signEndAt ||
      now < document.signEndAt ||
      !signers.some((signer) => signer.status === 'pending')
    )
      return false;
    for (const signer of signers) {
      if (signer.status === 'pending') {
        // 保留既有世代與期限供補簽驗證；到期狀態／期限已阻擋待簽授權。
        // 不保留可重建邀請的密文，也不回填歷史上缺漏的世代。
        signer.invitationTokenCiphertext = null;
      }
    }
    await this.signers.saveMany(signers, manager);
    document.status = 'expired';
    await this.documents.save(document, manager);
    await this.audit.append(
      {
        documentId: document.id,
        eventType: 'document.expired',
        occurredAt: new Date(),
        metadata: {
          status: 'expired',
          expiredAt: document.signEndAt.toISOString(),
        },
      },
      manager,
    );
    return true;
  }
}
