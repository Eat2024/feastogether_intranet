import { Injectable } from '@nestjs/common';
import {
  type DeepPartial,
  type EntityManager,
  type FindOptionsWhere,
  In,
  IsNull,
} from 'typeorm';
import { EsignDocument } from '../entities/esign-document.entity';
import { EsignInitiationJob } from '../entities/esign-initiation-job.entity';

/** 僅供列表讀取，不得將受理摘要寫回文件。 */
export type DocumentListProjection = EsignDocument & {
  isInitiating?: boolean;
  initiation?: {
    signStartAt: string;
    signEndAt: string;
    totalCount: number;
  } | null;
};

@Injectable()
export class DocumentRepository {
  private readonly nextDraftVersion =
    'GREATEST(UTC_TIMESTAMP(6), DATE_ADD(updated_at, INTERVAL 1 MICROSECOND))';

  /** 公開草稿異動在文件鎖內推進版本；不可放入 worker 共用的 buildFields。 */
  async touchDraftVersion(
    id: number,
    manager: EntityManager,
    previousVersion?: string,
  ): Promise<void> {
    // 單調微秒需由 DB 計算；save 的 CURRENT_TIMESTAMP 與 JS Date 都會損失精度。
    const version = previousVersion
      ? `GREATEST(${this.nextDraftVersion}, DATE_ADD(CAST(:previousVersion AS DATETIME(6)), INTERVAL 1 MICROSECOND))`
      : this.nextDraftVersion;
    const result = await manager
      .createQueryBuilder()
      .update(EsignDocument)
      .set({ updatedAt: () => version })
      .where('id = :id AND status = :status AND deleted_at IS NULL', {
        id,
        status: 'draft',
      })
      .setParameters({ previousVersion })
      .execute();
    if (result.affected !== 1) throw new Error('草稿版本更新失敗');
  }

  findById(id: number, manager: EntityManager) {
    return manager.findOne(EsignDocument, {
      where: { id, deletedAt: IsNull() },
    });
  }

  /** 工作受理／查詢只讀權限與狀態，重播不載入正式簽署快照。 */
  findInitiationAccess(id: number, manager: EntityManager, lock = false) {
    return manager.findOne(EsignDocument, {
      where: { id },
      select: {
        id: true,
        createdByUserId: true,
        deletedAt: true,
        status: true,
      },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
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

  findAllForList(manager: EntityManager) {
    return this.findList({}, manager);
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
  ): Promise<DocumentListProjection[]> {
    const { entities, raw: initiationRows } = await manager
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
        'document.createdByActorKind',
        'document.createdAt',
        'document.updatedAt',
        'document.signStartAt',
        'document.signEndAt',
        'document.initiatedAt',
        'document.completedAt',
        'document.stoppedAt',
      ])
      .leftJoin(
        EsignInitiationJob,
        'job',
        'job.activeDocumentId = document.id AND job.deletedAt IS NULL',
      )
      .addSelect('job.id', 'initiationJobId')
      .addSelect('job.totalCount', 'initiationTotalCount')
      .getRawAndEntities<{
        document_id: number | string;
        initiationJobId: number | string | null;
        initiationTotalCount: number | string | null;
      }>();
    const jobsByDocument = new Map(
      initiationRows
        .filter((row) => row.initiationJobId !== null)
        .map((row) => [
          Number(row.document_id),
          {
            id: Number(row.initiationJobId),
            totalCount: Number(row.initiationTotalCount),
          },
        ]),
    );
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
    // 日期只在無排序批次查詢抽取，避免大型 input_json 進入 filesort。
    const jobIds = [...jobsByDocument.values()].map((job) => job.id);
    const periods = jobIds.length
      ? await manager
          .createQueryBuilder(EsignInitiationJob, 'job')
          .select('job.id', 'id')
          .addSelect(
            "JSON_UNQUOTE(JSON_EXTRACT(job.input_json, '$.signStartAt'))",
            'signStartAt',
          )
          .addSelect(
            "JSON_UNQUOTE(JSON_EXTRACT(job.input_json, '$.signEndAt'))",
            'signEndAt',
          )
          .where('job.id IN (:...jobIds)', { jobIds })
          .getRawMany<{
            id: number | string;
            signStartAt: string;
            signEndAt: string;
          }>()
      : [];
    const periodsByJob = new Map(
      periods.map((period) => [Number(period.id), period]),
    );
    return entities.map((document) => {
      const job = jobsByDocument.get(document.id);
      const period = job ? periodsByJob.get(job.id) : undefined;
      const isInitiating = document.status === 'draft' && !!job;
      return Object.assign(document, {
        isInitiating,
        initiation:
          isInitiating && period
            ? {
                signStartAt: period.signStartAt,
                signEndAt: period.signEndAt,
                totalCount: job.totalCount,
              }
            : null,
      });
    });
  }

  create(fields: DeepPartial<EsignDocument>, manager: EntityManager) {
    return manager.create(EsignDocument, fields);
  }

  async save(document: EsignDocument, manager: EntityManager) {
    // 新建沒有舊版本；正式 activate 先將 status 設為 active，不進入草稿編輯分支。
    if (!document.id || document.status !== 'draft' || document.deletedAt)
      return manager.save(document);
    // 呼叫端已授權並持有文件鎖。以 DB 原始微秒作下限，不使用 entity 的毫秒 Date。
    const previous = await manager
      .createQueryBuilder(EsignDocument, 'document')
      .select(
        "DATE_FORMAT(document.updated_at, '%Y-%m-%d %H:%i:%s.%f')",
        'version',
      )
      .where(
        'document.id = :id AND document.status = :status AND document.deleted_at IS NULL',
        { id: document.id, status: 'draft' },
      )
      .setLock('pessimistic_write')
      .getRawOne<{ version: string }>();
    if (!previous) throw new Error('草稿版本不存在');
    const saved = await manager.save(document);
    // save 可能無 dirty 欄位，或將 updated_at 回退為整秒；兩種情況都明確遞增。
    await this.touchDraftVersion(document.id, manager, previous.version);
    const current = await manager.findOneOrFail(EsignDocument, {
      where: { id: document.id },
      select: { id: true, updatedAt: true },
    });
    saved.updatedAt = current.updatedAt;
    return saved;
  }

  updateDraft(
    id: number,
    fields: Partial<Pick<EsignDocument, 'title'>>,
    manager: EntityManager,
  ) {
    return manager
      .createQueryBuilder()
      .update(EsignDocument)
      .set({ ...fields, updatedAt: () => this.nextDraftVersion })
      .where('id = :id AND status = :status AND deleted_at IS NULL', {
        id,
        status: 'draft',
      })
      .execute();
  }

  softDeleteDraft(id: number, deletedAt: Date, manager: EntityManager) {
    return manager
      .createQueryBuilder()
      .update(EsignDocument)
      .set({ deletedAt, updatedAt: () => this.nextDraftVersion })
      .where('id = :id AND status = :status AND deleted_at IS NULL', {
        id,
        status: 'draft',
      })
      .execute();
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
