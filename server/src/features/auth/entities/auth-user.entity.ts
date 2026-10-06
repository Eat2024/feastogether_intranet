import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AuditableEntity } from '#app/infrastructure/database/auditable.entity';

/**
 * auth_users — 本地使用者（首次登入由饗賓 API 建立）。
 * 不含 password_hash / verification_code / 明文 token / birthdate（FR-016）。
 */
@Entity({ name: 'auth_users', comment: '本地使用者' })
export class AuthUser extends AuditableEntity {
  @PrimaryGeneratedColumn({ name: 'id', type: 'bigint', comment: '流水號' })
  id!: number;

  @Index('uq_auth_users_person_empid', { unique: true })
  @Column({
    name: 'person_empid',
    type: 'varchar',
    length: 32,
    comment: '員工工號（主要識別）',
  })
  personEmpid!: string;

  @Column({
    name: 'person_name',
    type: 'varchar',
    length: 100,
    comment: '姓名',
  })
  personName!: string;

  @Column({
    name: 'person_status',
    type: 'varchar',
    length: 50,
    nullable: true,
    comment: '來源人員狀態',
  })
  personStatus?: string;

  @Index('idx_auth_users_role_id')
  @Column({
    name: 'role_id',
    type: 'bigint',
    nullable: true,
    comment: '單一系統角色（FK→auth_roles.id）；NULL=無功能權限',
  })
  roleId?: number;

  @Index('idx_auth_users_department_code')
  @Column({
    name: 'department_code',
    type: 'varchar',
    length: 50,
    nullable: true,
    comment: '部門/門市代碼（顯示）',
  })
  departmentCode?: string;

  @Column({
    name: 'department_name',
    type: 'varchar',
    length: 150,
    nullable: true,
    comment: '部門名稱（冗餘顯示；來源同步時一併寫入）',
  })
  departmentName?: string;

  @Column({
    name: 'title_name',
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: '職稱名稱（冗餘顯示；來源同步時一併寫入）',
  })
  titleName?: string;

  @Column({
    name: 'description',
    type: 'varchar',
    length: 500,
    nullable: true,
    comment: '本地備註（不被登入同步覆蓋）',
  })
  description?: string;

  @Column({
    name: 'is_active',
    type: 'boolean',
    default: true,
    comment: '帳號啟用',
  })
  isActive!: boolean;

  @Column({
    name: 'last_login_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
    comment: '最後登入時間',
  })
  lastLoginAt?: Date;

  @Column({
    name: 'oauth_sub',
    type: 'varchar',
    length: 255,
    charset: 'ascii',
    collation: 'ascii_bin',
    nullable: true,
    comment: '最近一次統一登入的 OAuth sub（NULL＝未曾用統一登入；非識別鍵）',
  })
  oauthSub?: string;
}
