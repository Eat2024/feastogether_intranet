import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { AuditableEntity } from '#app/infrastructure/database/auditable.entity';

/** auth_role_permissions — 角色 × 權限（M:N）。 */
@Entity({ name: 'auth_role_permissions', comment: '角色 × 權限（M:N）' })
@Unique('uq_auth_role_permissions_role_perm', ['roleId', 'permissionId'])
export class AuthRolePermission extends AuditableEntity {
  @PrimaryGeneratedColumn({ name: 'id', type: 'bigint', comment: '流水號' })
  id!: number;

  @Index('idx_auth_role_permissions_role_id')
  @Column({
    name: 'role_id',
    type: 'bigint',
    comment: '角色（FK→auth_roles.id）',
  })
  roleId!: number;

  @Index('idx_auth_role_permissions_permission_id')
  @Column({
    name: 'permission_id',
    type: 'bigint',
    comment: '權限（FK→auth_job_permission.id）',
  })
  permissionId!: number;
}
