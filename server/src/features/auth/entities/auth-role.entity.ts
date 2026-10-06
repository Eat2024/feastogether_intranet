import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AuditableEntity } from '#app/infrastructure/database/auditable.entity';

/** auth_roles — 本地系統角色。 */
@Entity({ name: 'auth_roles', comment: '本地系統角色' })
export class AuthRole extends AuditableEntity {
  @PrimaryGeneratedColumn({ name: 'id', type: 'bigint', comment: '流水號' })
  id!: number;

  @Index('uq_auth_roles_role_code', { unique: true })
  @Column({
    name: 'role_code',
    type: 'varchar',
    length: 50,
    comment: '角色代碼（後端產生，不可前端編輯；ADMIN 保留）',
  })
  roleCode!: string;

  @Column({
    name: 'role_name',
    type: 'varchar',
    length: 100,
    comment: '角色名稱',
  })
  roleName!: string;

  @Column({
    name: 'is_admin',
    type: 'boolean',
    default: false,
    comment: '全權限角色',
  })
  isAdmin!: boolean;

  @Column({
    name: 'is_active',
    type: 'boolean',
    default: true,
    comment: '啟用',
  })
  isActive!: boolean;

  @Column({
    name: 'sort_order',
    type: 'int',
    nullable: true,
    comment: '顯示排序',
  })
  sortOrder?: number;
}
