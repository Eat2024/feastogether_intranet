import { Column, DeleteDateColumn, UpdateDateColumn } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * 所有業務 entity 的共用基底：在 {@link BaseEntity}（created_at）之上，
 * 再加更新時間戳 + 稽核者 + 軟刪除。
 *
 * 用法（自行定義 PK）：
 *   @Entity({ name: 'foo' })
 *   export class Auth_Users extends AuditableEntity {
 *     @PrimaryGeneratedColumn() id: number;
 *     // ...其他欄位
 *   }
 *
 * - createdAt（繼承 BaseEntity）/ updatedAt：TypeORM 透過 save() 自動維護
 * - createdBy / updatedBy：AuditSubscriber 從登入者(CLS)自動注入（save() 時）
 * - deletedAt：啟用軟刪除，請用 repository.softRemove() / softDelete()
 */
export abstract class AuditableEntity extends BaseEntity {
  @UpdateDateColumn({
    name: 'updated_at',
    type: 'datetime',
    comment: '更新時間',
  })
  updatedAt!: Date;

  @DeleteDateColumn({
    name: 'deleted_at',
    type: 'datetime',
    nullable: true,
    comment: '刪除時間（軟刪除）',
  })
  deletedAt?: Date;

  @Column({
    name: 'created_by',
    type: 'varchar',
    length: 64,
    nullable: true,
    comment: '建立者（使用者 ID）',
  })
  createdBy?: string;

  @Column({
    name: 'updated_by',
    type: 'varchar',
    length: 64,
    nullable: true,
    comment: '更新者（使用者 ID）',
  })
  updatedBy?: string;
}
