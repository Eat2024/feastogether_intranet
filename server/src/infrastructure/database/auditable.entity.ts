import { DeleteDateColumn, UpdateDateColumn } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * 所有業務 entity 的共用基底：在 {@link BaseEntity}（created_at）之上，
 * 再加更新時間戳與軟刪除。需要記錄員工操作人的 entity 改繼承
 * user-auditable subclass，避免所有業務表被迫增加未定義的 actor 欄位。
 *
 * 用法（自行定義 PK）：
 *   @Entity({ name: 'foo' })
 *   export class Auth_Users extends AuditableEntity {
 *     @PrimaryGeneratedColumn() id: number;
 *     // ...其他欄位
 *   }
 *
 * - createdAt（繼承 BaseEntity）/ updatedAt：TypeORM 透過 save() 自動維護
 * - deletedAt：啟用軟刪除，請用 repository.softRemove() / softDelete()
 */
export abstract class AuditableEntity extends BaseEntity {
  @UpdateDateColumn({
    name: 'updated_at',
    type: 'datetime',
    precision: 6,
    comment: '更新時間',
  })
  updatedAt!: Date;

  @DeleteDateColumn({
    name: 'deleted_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
    comment: '軟刪除時間',
  })
  deletedAt?: Date;
}
