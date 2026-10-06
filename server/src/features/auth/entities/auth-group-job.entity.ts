import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { AuditableEntity } from '#app/infrastructure/database/auditable.entity';

/** auth_group_jobs — 功能項目（層級第二層）。 */
@Entity({ name: 'auth_group_jobs', comment: '功能項目（層級第二層）' })
@Unique('uq_auth_group_jobs_group_job', ['groupId', 'jobKey'])
export class AuthGroupJob extends AuditableEntity {
  @PrimaryGeneratedColumn({ name: 'id', type: 'bigint', comment: '流水號' })
  id!: number;

  @Index('idx_auth_group_jobs_group_id')
  @Column({
    name: 'group_id',
    type: 'bigint',
    comment: '分組（FK→auth_group.id）',
  })
  groupId!: number;

  @Column({
    name: 'job_key',
    type: 'varchar',
    length: 100,
    comment: '功能鍵，例 roleManagement',
  })
  jobKey!: string;

  @Column({
    name: 'job_name',
    type: 'varchar',
    length: 100,
    comment: '功能名稱',
  })
  jobName!: string;

  @Column({
    name: 'sort_order',
    type: 'int',
    nullable: true,
    comment: '顯示排序',
  })
  sortOrder?: number;

  @Column({
    name: 'is_active',
    type: 'boolean',
    default: true,
    comment: '啟用（隱藏整功能用此）',
  })
  isActive!: boolean;
}
