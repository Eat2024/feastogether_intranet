import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '#app/features/users/entities/user.entity';
import { AuditableEntity } from '#app/infrastructure/database/auditable.entity';
import type { ActorKind, SessionSource } from '../auth.types';

export const AUTH_SESSION_STATUS = {
  VALIDATING: 'validating',
  PENDING: 'pending',
  ACTIVE: 'active',
  FAILED: 'failed',
  REVOKED: 'revoked',
} as const;

export type AuthSessionStatus =
  (typeof AUTH_SESSION_STATUS)[keyof typeof AUTH_SESSION_STATUS];

@Entity({ name: 'auth_sessions', comment: 'WebView 啟動與員工登入 Session' })
@Check(
  'chk_auth_sessions_status',
  "`status` IN ('validating','pending','active','failed','revoked')",
)
@Check(
  'chk_auth_sessions_actor',
  "(`actor_kind` = 'employee' AND `credential_generation` IS NULL AND `source` IN ('webview','oauth') AND (`status` IN ('validating','failed') OR `user_id` IS NOT NULL)) OR (`actor_kind` = 'super_user' AND `user_id` IS NULL AND `credential_generation` IS NOT NULL AND `source` = 'super_user' AND `status` NOT IN ('validating','pending'))",
)
@Check(
  'chk_auth_sessions_active_session',
  "`status` <> 'active' OR (`session_token_hash` IS NOT NULL AND `activated_at` IS NOT NULL AND `expires_at` IS NOT NULL)",
)
@Index('uq_auth_sessions_source_jti_hash', ['sourceJtiHash'], { unique: true })
@Index('uq_auth_sessions_launch_code_hash', ['launchCodeHash'], {
  unique: true,
})
@Index('uq_auth_sessions_session_token_hash', ['sessionTokenHash'], {
  unique: true,
})
@Index('uq_auth_sessions_replacement_session_id', ['replacementSessionId'], {
  unique: true,
})
@Index('idx_auth_sessions_status_launch_expires_at', [
  'status',
  'launchExpiresAt',
])
@Index('idx_auth_sessions_status_expires_at', ['status', 'expiresAt'])
@Index('idx_auth_sessions_user_created_at', ['userId', 'createdAt'])
@Index('idx_auth_sessions_actor_generation_status', [
  'actorKind',
  'credentialGeneration',
  'status',
])
@Index('idx_auth_sessions_deleted_at', ['deletedAt'])
export class AuthSession extends AuditableEntity {
  @PrimaryGeneratedColumn({
    name: 'id',
    type: 'bigint',
    unsigned: true,
    comment: '認證流程流水號',
  })
  id!: number;

  @Column({
    name: 'actor_kind',
    type: 'varchar',
    length: 20,
    default: 'employee',
    comment: '操作者類型',
  })
  actorKind!: ActorKind;

  @Column({
    name: 'user_id',
    type: 'bigint',
    nullable: true,
    comment: '員工 ID',
  })
  userId!: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'fk_auth_sessions_user',
  })
  user?: User | null;

  @Column({
    name: 'source',
    type: 'varchar',
    length: 20,
    comment: '認證來源',
  })
  source!: SessionSource;

  @Column({
    name: 'credential_generation',
    type: 'bigint',
    unsigned: true,
    nullable: true,
    comment: 'Super user 帳密啟用版本',
  })
  credentialGeneration!: number | null;

  @Column({ name: 'status', type: 'varchar', length: 20, comment: '認證狀態' })
  status!: AuthSessionStatus;

  @Column({
    name: 'source_jti_hash',
    type: 'char',
    length: 64,
    charset: 'ascii',
    collation: 'ascii_bin',
    comment: '來源 JWT jti SHA-256',
  })
  sourceJtiHash!: string;

  @Column({
    name: 'launch_code_hash',
    type: 'char',
    length: 64,
    charset: 'ascii',
    collation: 'ascii_bin',
    nullable: true,
    comment: '啟動碼 SHA-256',
  })
  launchCodeHash!: string | null;

  @Column({
    name: 'session_token_hash',
    type: 'char',
    length: 64,
    charset: 'ascii',
    collation: 'ascii_bin',
    nullable: true,
    comment: '登入識別摘要 SHA-256',
  })
  sessionTokenHash!: string | null;

  @Column({
    name: 'assertion_expires_at',
    type: 'datetime',
    precision: 3,
    comment: '來源 assertion 到期時間',
  })
  assertionExpiresAt!: Date;

  @Column({
    name: 'launch_expires_at',
    type: 'datetime',
    precision: 3,
    nullable: true,
    comment: '啟動碼到期時間',
  })
  launchExpiresAt!: Date | null;

  @Column({
    name: 'verified_at',
    type: 'datetime',
    precision: 3,
    nullable: true,
    comment: '員工驗證完成時間',
  })
  verifiedAt!: Date | null;

  @Column({
    name: 'activated_at',
    type: 'datetime',
    precision: 3,
    nullable: true,
    comment: 'Session 啟用時間',
  })
  activatedAt!: Date | null;

  @Column({
    name: 'expires_at',
    type: 'datetime',
    precision: 3,
    nullable: true,
    comment: 'Session 到期時間',
  })
  expiresAt!: Date | null;

  @Column({
    name: 'revoked_at',
    type: 'datetime',
    precision: 3,
    nullable: true,
    comment: 'Session 撤銷時間',
  })
  revokedAt!: Date | null;

  @Column({
    name: 'replacement_session_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
    comment: '取代本會話的新會話 ID',
  })
  replacementSessionId!: number | null;

  @ManyToOne(() => AuthSession, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'replacement_session_id',
    foreignKeyConstraintName: 'fk_auth_sessions_replacement',
  })
  replacementSession?: AuthSession | null;

  @Column({
    name: 'failure_code',
    type: 'varchar',
    length: 50,
    nullable: true,
    comment: '失敗分類',
  })
  failureCode!: string | null;
}
