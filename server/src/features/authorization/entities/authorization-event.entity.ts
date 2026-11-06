import { Column, Entity, Index, PrimaryGeneratedColumn, Check } from 'typeorm';
import { BaseEntity } from '#app/infrastructure/database/base.entity';

/** 授權異動紀錄（append-only）。 */
@Entity({
  name: 'authorization_events',
  comment: '授權異動紀錄（append-only）',
})
@Index('idx_authorization_events_created_at', ['createdAt'])
@Index('idx_authorization_events_occurred_at', ['occurredAt'])
@Check(
  'chk_authorization_events_actor_kind',
  "`actor_kind` IN ('super_user','operator','system')",
)
@Check(
  'chk_authorization_events_source',
  "`source` IN ('http','repl','migration')",
)
@Check(
  'chk_authorization_events_target_kind',
  "`target_kind` IN ('role','user','catalog')",
)
export class AuthorizationEvent extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true, comment: '識別碼' })
  id!: number;

  @Column({
    name: 'occurred_at',
    type: 'datetime',
    comment: '事件時間',
    precision: 6,
  })
  occurredAt!: Date;

  @Column({
    name: 'actor_kind',
    type: 'varchar',
    comment: '操作者種類',
    length: 20,
  })
  actorKind!: 'super_user' | 'operator' | 'system';

  @Column({ name: 'source', type: 'varchar', comment: '操作來源', length: 10 })
  source!: 'http' | 'repl' | 'migration';

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
    name: 'event_type',
    type: 'varchar',
    comment: '事件種類',
    length: 64,
  })
  eventType!: string;

  @Column({
    name: 'target_kind',
    type: 'varchar',
    comment: '目標種類',
    length: 20,
  })
  targetKind!: 'role' | 'user' | 'catalog';

  @Column({
    name: 'target_id',
    type: 'bigint',
    comment: '目標 ID',
    nullable: true,
  })
  targetId!: number | null;

  @Column({
    name: 'request_id',
    type: 'varchar',
    comment: '請求追蹤 ID',
    length: 64,
    nullable: true,
  })
  requestId!: string | null;

  @Column({
    name: 'before_json',
    type: 'json',
    comment: '異動前白名單內容',
    nullable: true,
  })
  beforeJson!: Record<string, unknown> | null;

  @Column({
    name: 'after_json',
    type: 'json',
    comment: '異動後白名單內容',
    nullable: true,
  })
  afterJson!: Record<string, unknown> | null;
}
