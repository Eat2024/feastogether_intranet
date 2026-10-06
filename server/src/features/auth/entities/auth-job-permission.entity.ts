import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { AuditableEntity } from '#app/infrastructure/database/auditable.entity';

/** auth_job_permission — 功能權限（層級第三層，授權葉節點）。 */
@Entity({
  name: 'auth_job_permission',
  comment: '功能權限（層級第三層，授權葉節點）',
})
@Unique('uq_auth_job_permission_job_action', ['jobId', 'action'])
export class AuthJobPermission extends AuditableEntity {
  @PrimaryGeneratedColumn({ name: 'id', type: 'bigint', comment: '流水號' })
  id!: number;

  @Index('idx_auth_job_permission_job_id')
  @Column({
    name: 'job_id',
    type: 'bigint',
    comment: '功能（FK→auth_group_jobs.id）',
  })
  jobId!: number;

  @Index('uq_auth_job_permission_key', { unique: true })
  @Column({
    name: 'permission_key',
    type: 'varchar',
    length: 150,
    comment: '<job_key>.<action>',
  })
  permissionKey!: string;

  @Column({
    name: 'action',
    type: 'varchar',
    length: 30,
    comment: 'view / createEdit / delete / printExport',
  })
  action!: string;

  @Column({
    name: 'permission_name',
    type: 'varchar',
    length: 150,
    comment: '權限全名，例 查看角色管理',
  })
  permissionName!: string;

  @Column({
    name: 'sort_order',
    type: 'int',
    nullable: true,
    comment: '顯示排序',
  })
  sortOrder?: number;
}
