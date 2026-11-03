import { Injectable } from '@nestjs/common';
import {
  type DeepPartial,
  type EntityManager,
  type FindOptionsWhere,
  In,
  IsNull,
} from 'typeorm';
import { EsignDocument } from '../entities/esign-document.entity';

@Injectable()
export class DocumentRepository {
  findById(id: number, manager: EntityManager) {
    return manager.findOne(EsignDocument, {
      where: { id, deletedAt: IsNull() },
    });
  }

  findByIdForUpdate(id: number, manager: EntityManager) {
    return manager.findOne(EsignDocument, {
      where: { id, deletedAt: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });
  }

  findCreatedByUser(createdByUserId: number, manager: EntityManager) {
    return manager.find(EsignDocument, {
      where: { createdByUserId, deletedAt: IsNull() },
      order: { updatedAt: 'DESC', id: 'DESC' },
    });
  }

  findByDepartment(createdByDepartmentCode: string, manager: EntityManager) {
    return this.findList({ createdByDepartmentCode }, manager);
  }

  findListCreatedByUser(createdByUserId: number, manager: EntityManager) {
    return this.findList({ createdByUserId }, manager);
  }

  findListByIds(ids: number[], manager: EntityManager) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.findList({ id: In(ids) }, manager);
  }

  /** 列表專用投影；不載入完整快照，避免大型 JSON 隨 filesort 耗盡排序記憶體。 */
  private async findList(
    where: FindOptionsWhere<EsignDocument>,
    manager: EntityManager,
  ) {
    const entities = await manager
      .createQueryBuilder(EsignDocument, 'document')
      .setFindOptions({
        where: { ...where, deletedAt: IsNull() },
        order: { updatedAt: 'DESC', id: 'DESC' },
      })
      .select([
        'document.id',
        'document.docNumber',
        'document.title',
        'document.status',
        'document.createdByUserId',
        'document.createdAt',
        'document.updatedAt',
        'document.signStartAt',
        'document.signEndAt',
        'document.initiatedAt',
        'document.completedAt',
        'document.stoppedAt',
      ])
      .getMany();
    if (entities.length === 0) return entities;
    // JSON_EXTRACT 的來源欄位也可能進入 MySQL filesort；分開讀取且不排序。
    const raw = await manager
      .createQueryBuilder(EsignDocument, 'document')
      .select('document.id', 'listDocumentId')
      .addSelect(
        `CASE WHEN JSON_TYPE(JSON_EXTRACT(document.signing_payload_json, '$.period.endAt')) = 'STRING'
          THEN JSON_UNQUOTE(JSON_EXTRACT(document.signing_payload_json, '$.period.endAt'))
          ELSE NULL END`,
        'originalSignEndAt',
      )
      .where('document.id IN (:...ids)', {
        ids: entities.map((document) => document.id),
      })
      .getRawMany<{
        listDocumentId: number;
        originalSignEndAt: string | null;
      }>();
    const originalEnds = new Map(
      raw.map((row) => [Number(row.listDocumentId), row.originalSignEndAt]),
    );
    // 僅重建 mapper 需要的截止時間；此投影不可作為簽署快照驗證或寫入來源。
    for (const document of entities) {
      document.signingPayloadJson = {
        period: { endAt: originalEnds.get(document.id) ?? null },
      };
    }
    return entities;
  }

  create(fields: DeepPartial<EsignDocument>, manager: EntityManager) {
    return manager.create(EsignDocument, fields);
  }

  save(document: EsignDocument, manager: EntityManager) {
    return manager.save(document);
  }

  updateDraft(
    id: number,
    fields: Partial<Pick<EsignDocument, 'title'>>,
    manager: EntityManager,
  ) {
    return manager.update(
      EsignDocument,
      { id, status: 'draft', deletedAt: IsNull() },
      fields,
    );
  }

  softDeleteDraft(id: number, deletedAt: Date, manager: EntityManager) {
    return manager.update(
      EsignDocument,
      { id, status: 'draft', deletedAt: IsNull() },
      { deletedAt },
    );
  }

  findFinalizationCandidates(afterId: number, manager: EntityManager) {
    return manager
      .createQueryBuilder(EsignDocument, 'document')
      .select('document.id', 'id')
      .where("document.status = 'finalizing'")
      .andWhere('document.id > :afterId', { afterId })
      .andWhere(
        `NOT EXISTS (SELECT 1 FROM esign_signers signer WHERE signer.document_id = document.id AND signer.deleted_at IS NULL AND (signer.status = 'pending' OR (signer.status = 'signed' AND (signer.completion_status IS NULL OR signer.completion_status <> 'ready'))))`,
      )
      .orderBy('document.id', 'ASC')
      .limit(100)
      .getRawMany<{ id: string }>();
  }

  findExpiredActiveIds(now: Date, manager: EntityManager, afterId = 0) {
    return manager
      .createQueryBuilder(EsignDocument, 'document')
      .select('document.id', 'id')
      .where("document.status = 'active'")
      .andWhere('document.sign_end_at <= :now', { now })
      .andWhere('document.id > :afterId', { afterId })
      .andWhere(
        `EXISTS (
          SELECT 1 FROM esign_signers signer
          WHERE signer.document_id = document.id
            AND signer.deleted_at IS NULL
            AND signer.status = 'pending'
        )`,
      )
      .orderBy('document.id', 'ASC')
      .limit(100)
      .getRawMany<{ id: string }>();
  }
}
