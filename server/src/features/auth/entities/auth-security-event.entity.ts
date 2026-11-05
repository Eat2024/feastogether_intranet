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
import { BaseEntity } from '#app/infrastructure/database/base.entity';
import { AuthSession } from './auth-session.entity';

export type AuthSecurityEventType =
  | 'login.succeeded'
  | 'login.rejected'
  | 'session.replaced'
  | 'session.revoked'
  | 'credentials.activated'
  | 'entry.initialized'
  | 'entry.rotated';

/** 事件操作身分：會話身分之外，另有 REPL 操作者、系統排程與未登入者。 */
export type AuthSecurityEventActorKind =
  | 'employee'
  | 'super_user'
  | 'operator'
  | 'system'
  | 'anonymous';

/** 白名單結果碼；不保存任意例外訊息。 */
export type AuthSecurityOutcome =
  | 'succeeded'
  | 'credentials_invalid'
  | 'replaced'
  | 'logout';

/**
 * 登入與維護安全事件，append-only：不提供 update／delete，也不保存帳號、密碼、IP、UA、
 * body、完整入口、token 或帳密指紋。與已停用的文件簽署歷程無關。
 */
@Entity({
  name: 'auth_security_events',
  comment: '登入與維護安全事件（append-only）',
})
@Check(
  'chk_auth_security_events_event_type',
  "`event_type` IN ('login.succeeded','login.rejected','session.replaced','session.revoked','credentials.activated','entry.initialized','entry.rotated')",
)
@Check(
  'chk_auth_security_events_actor_kind',
  "`actor_kind` IN ('employee','super_user','operator','system','anonymous')",
)
@Check(
  'chk_auth_security_events_actor_user',
  "(`actor_kind` = 'employee' AND `actor_user_id` IS NOT NULL) OR (`actor_kind` <> 'employee' AND `actor_user_id` IS NULL)",
)
@Index('idx_auth_security_events_occurred_at', ['occurredAt'])
@Index('idx_auth_security_events_created_at', ['createdAt'])
export class AuthSecurityEvent extends BaseEntity {
  @PrimaryGeneratedColumn({
    name: 'id',
    type: 'bigint',
    unsigned: true,
    comment: '事件流水號',
  })
  id!: number;

  @Column({
    name: 'event_type',
    type: 'varchar',
    length: 64,
    comment: '事件種類',
  })
  eventType!: AuthSecurityEventType;

  @Column({
    name: 'actor_kind',
    type: 'varchar',
    length: 20,
    comment: '操作身分類型',
  })
  actorKind!: AuthSecurityEventActorKind;

  @Column({
    name: 'actor_user_id',
    type: 'bigint',
    nullable: true,
    comment: '員工 ID（僅員工事件）',
  })
  actorUserId!: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'actor_user_id',
    foreignKeyConstraintName: 'fk_auth_security_events_actor_user',
  })
  actorUser?: User | null;

  @Column({
    name: 'session_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
    comment: '關聯會話 ID',
  })
  sessionId!: number | null;

  @ManyToOne(() => AuthSession, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'session_id',
    foreignKeyConstraintName: 'fk_auth_security_events_session',
  })
  session?: AuthSession | null;

  @Column({
    name: 'outcome_code',
    type: 'varchar',
    length: 64,
    comment: '白名單結果碼',
  })
  outcomeCode!: AuthSecurityOutcome;

  @Column({
    name: 'credential_generation',
    type: 'bigint',
    unsigned: true,
    nullable: true,
    comment: '相關帳密啟用版本',
  })
  credentialGeneration!: number | null;

  @Column({
    name: 'entry_generation',
    type: 'bigint',
    unsigned: true,
    nullable: true,
    comment: '相關入口輪換版本',
  })
  entryGeneration!: number | null;

  @Column({
    name: 'request_id',
    type: 'varchar',
    length: 64,
    nullable: true,
    comment: '請求追蹤 ID',
  })
  requestId!: string | null;

  @Column({
    name: 'occurred_at',
    type: 'datetime',
    precision: 6,
    comment: '事件發生時間',
  })
  occurredAt!: Date;
}
