import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { AuditableEntity } from '#app/infrastructure/database/auditable.entity';

/**
 * auth_api_permissions — 端點 × 權限（M:N，OR 語意）。
 * 未綁任何權限 = 無人可呼叫（default-deny）；公開端點以 is_public 放行，不綁空權限。
 */
@Entity({
  name: 'auth_api_permissions',
  comment: '端點 × 權限（M:N，OR 語意）',
})
@Unique('uq_auth_api_permissions_api_perm', ['apiId', 'permissionId'])
export class AuthApiPermission extends AuditableEntity {
  @PrimaryGeneratedColumn({ name: 'id', type: 'bigint', comment: '流水號' })
  id!: number;

  @Index('idx_auth_api_permissions_api_id')
  @Column({
    name: 'api_id',
    type: 'bigint',
    comment: '端點（FK→auth_apis.id）',
  })
  apiId!: number;

  @Index('idx_auth_api_permissions_permission_id')
  @Column({
    name: 'permission_id',
    type: 'bigint',
    comment: '權限（FK→auth_job_permission.id）',
  })
  permissionId!: number;
}
