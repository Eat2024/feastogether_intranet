import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { AuditableEntity } from '#app/infrastructure/database/auditable.entity';
import { AuthorizationRole } from './authorization-role.entity';
import { AuthorizationPermission } from './authorization-permission.entity';

/** 角色權限關聯。 */
@Entity({ name: 'authorization_role_permissions', comment: '角色權限關聯' })
@Index('idx_authorization_role_permissions_created_at', ['createdAt'])
@Index('idx_authorization_role_permissions_updated_at', ['updatedAt'])
@Index('idx_authorization_role_permissions_deleted_at', ['deletedAt'])
@Index('uq_authorization_role_permissions_pair', ['roleId', 'permissionId'], {
  unique: true,
})
export class AuthorizationRolePermission extends AuditableEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true, comment: '識別碼' })
  id!: number;

  @Column({
    name: 'module_key',
    type: 'varchar',
    comment: '子功能代碼',
    length: 50,
    charset: 'ascii',
    collation: 'ascii_bin',
  })
  moduleKey!: string;

  @Column({
    name: 'role_id',
    type: 'bigint',
    comment: '角色 ID',
    unsigned: true,
  })
  roleId!: number;

  @Column({
    name: 'permission_id',
    type: 'bigint',
    comment: '權限 ID',
    unsigned: true,
  })
  permissionId!: number;

  @ManyToOne(() => AuthorizationRole, { onDelete: 'RESTRICT' })
  @JoinColumn([
    {
      name: 'module_key',
      referencedColumnName: 'moduleKey',
      foreignKeyConstraintName: 'fk_authorization_role_permissions_role_scope',
    },
    {
      name: 'role_id',
      referencedColumnName: 'id',
      foreignKeyConstraintName: 'fk_authorization_role_permissions_role_scope',
    },
  ])
  role?: AuthorizationRole;
  @ManyToOne(() => AuthorizationPermission, { onDelete: 'RESTRICT' })
  @JoinColumn([
    {
      name: 'module_key',
      referencedColumnName: 'moduleKey',
      foreignKeyConstraintName:
        'fk_authorization_role_permissions_permission_scope',
    },
    {
      name: 'permission_id',
      referencedColumnName: 'id',
      foreignKeyConstraintName:
        'fk_authorization_role_permissions_permission_scope',
    },
  ])
  permission?: AuthorizationPermission;
}
