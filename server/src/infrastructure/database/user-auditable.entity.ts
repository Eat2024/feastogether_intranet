import { Column } from 'typeorm';
import { AuditableEntity } from './auditable.entity';

/** 需要追蹤員工操作人的可編輯資料基底。system／worker 寫入時 actor 可為 NULL。 */
export abstract class UserAuditableEntity extends AuditableEntity {
  @Column({
    name: 'created_by_user_id',
    type: 'bigint',
    nullable: true,
    comment: '建立者員工 ID',
  })
  createdByUserId?: number;

  @Column({
    name: 'updated_by_user_id',
    type: 'bigint',
    nullable: true,
    comment: '更新者員工 ID',
  })
  updatedByUserId?: number;
}
