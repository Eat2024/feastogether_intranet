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
import { User } from '#app/features/users/entities/user.entity';

/** 員工角色關聯。 */
@Entity({ name: 'authorization_user_roles', comment: '員工角色關聯' })
@Index('idx_authorization_user_roles_created_at', ['createdAt'])
@Index('idx_authorization_user_roles_updated_at', ['updatedAt'])
@Index('idx_authorization_user_roles_deleted_at', ['deletedAt'])
@Index('uq_authorization_user_roles_pair', ['userId', 'roleId'], {
  unique: true,
})
@Index('idx_authorization_user_roles_user_scope', [
  'userId',
  'moduleKey',
  'deletedAt',
])
export class AuthorizationUserRole extends AuditableEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true, comment: '識別碼' })
  id!: number;

  @Column({ name: 'user_id', type: 'bigint', comment: '員工 ID' })
  userId!: number;

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

  @ManyToOne(() => AuthorizationRole, { onDelete: 'RESTRICT' })
  @JoinColumn([
    {
      name: 'module_key',
      referencedColumnName: 'moduleKey',
      foreignKeyConstraintName: 'fk_authorization_user_roles_role_scope',
    },
    {
      name: 'role_id',
      referencedColumnName: 'id',
      foreignKeyConstraintName: 'fk_authorization_user_roles_role_scope',
    },
  ])
  role?: AuthorizationRole;
  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'fk_authorization_user_roles_user',
  })
  user?: User;
}
