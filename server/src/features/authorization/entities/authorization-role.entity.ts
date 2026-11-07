import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AuditableEntity } from '#app/infrastructure/database/auditable.entity';

/** 角色。 */
@Entity({ name: 'authorization_roles', comment: '角色' })
@Index('idx_authorization_roles_created_at', ['createdAt'])
@Index('idx_authorization_roles_updated_at', ['updatedAt'])
@Index('idx_authorization_roles_deleted_at', ['deletedAt'])
@Index('uq_authorization_roles_code', ['moduleKey', 'roleCode'], {
  unique: true,
})
@Index('uq_authorization_roles_scope', ['moduleKey', 'id'], { unique: true })
@Index('uq_authorization_roles_name', ['moduleKey', 'activeRoleName'], {
  unique: true,
})
export class AuthorizationRole extends AuditableEntity {
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
    name: 'role_code',
    type: 'varchar',
    comment: '穩定角色代碼',
    length: 80,
    charset: 'ascii',
    collation: 'ascii_bin',
  })
  roleCode!: string;

  @Column({
    name: 'role_name',
    type: 'varchar',
    comment: '角色名稱',
    length: 100,
    collation: 'utf8mb4_0900_bin',
  })
  roleName!: string;

  @Column({
    name: 'is_active',
    type: 'boolean',
    comment: '是否啟用',
    default: true,
  })
  isActive!: boolean;

  @Column({
    name: 'version',
    type: 'int',
    comment: '設定版本',
    unsigned: true,
    default: 1,
  })
  version!: number;

  @Column({
    name: 'active_role_name',
    type: 'varchar',
    comment: '未刪除角色名稱',
    length: 100,
    collation: 'utf8mb4_0900_bin',
    asExpression: 'CASE WHEN deleted_at IS NULL THEN role_name ELSE NULL END',
    generatedType: 'VIRTUAL',
    nullable: true,
    insert: false,
    update: false,
  })
  activeRoleName!: string | null;
}
