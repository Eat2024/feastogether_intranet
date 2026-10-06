import { CreateDateColumn } from 'typeorm';

/**
 * 所有 entity 的最小共用基底：只有 created_at。
 *
 * - 業務表：改繼承 {@link AuditableEntity}（在此之上再加 updated_at / deleted_at /
 *   created_by / updated_by）。
 * - append-only 的 log / 稽核表：直接繼承本類，刻意不帶 update / soft-delete 欄位，
 *   讓 TypeORM 不暴露 update / softRemove 語意，避免紀錄被竄改（操作者請用各自的
 *   業務欄位表達，例：audit_logs.actor_user_id）。
 *
 * 注意：與 TypeORM 內建的 ActiveRecord BaseEntity 同名但無關；本專案採 repository /
 * DataMapper 模式，不使用 ActiveRecord。
 */
export abstract class BaseEntity {
  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
    comment: '建立時間',
  })
  createdAt!: Date;
}
