import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AuditableEntity } from '#app/infrastructure/database/auditable.entity';

/** 權限目錄。 */
@Entity({ name: 'authorization_permissions', comment: '權限目錄' })
@Index('idx_authorization_permissions_created_at', ['createdAt'])
@Index('idx_authorization_permissions_updated_at', ['updatedAt'])
@Index('idx_authorization_permissions_deleted_at', ['deletedAt'])
@Index('uq_authorization_permissions_key', ['permissionKey'], { unique: true })
@Index('uq_authorization_permissions_scope', ['moduleKey', 'id'], {
  unique: true,
})
export class AuthorizationPermission extends AuditableEntity {
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
    name: 'permission_key',
    type: 'varchar',
    comment: '權限代碼',
    length: 100,
    charset: 'ascii',
    collation: 'ascii_bin',
  })
  permissionKey!: string;

  @Column({
    name: 'permission_name',
    type: 'varchar',
    comment: '權限名稱',
    length: 100,
  })
  permissionName!: string;

  @Column({ name: 'assignable', type: 'boolean', comment: '可否指派' })
  assignable!: boolean;
}
