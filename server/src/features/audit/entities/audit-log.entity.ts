import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '#app/infrastructure/database/base.entity';

/** 全系統共用稽核歷史（append-only）。 */
@Entity({ name: 'audit_logs', comment: '通用稽核歷史紀錄（append-only）' })
@Index('idx_audit_logs_created_at', ['createdAt'])
@Index('idx_audit_logs_entity', ['entityType', 'entityId', 'createdAt', 'id'])
@Index('idx_audit_logs_actor', ['actorUserId', 'createdAt', 'id'])
@Index('idx_audit_logs_action', ['action', 'createdAt', 'id'])
@Index('idx_audit_logs_module', ['moduleKey', 'createdAt', 'id'])
export class AuditLog extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true, comment: '識別碼' })
  id!: number;

  @Column({ name: 'action', type: 'varchar', length: 80, comment: '稽核動作' })
  action!: string;

  @Column({
    name: 'entity_type',
    type: 'varchar',
    length: 80,
    comment: '主要目標型別',
  })
  entityType!: string;

  @Column({
    name: 'entity_id',
    type: 'varchar',
    length: 64,
    comment: '主要目標 ID',
  })
  entityId!: string;

  @Column({
    name: 'actor_user_id',
    type: 'bigint',
    nullable: true,
    comment: '操作者本地使用者 ID',
  })
  actorUserId!: number | null;

  @Column({
    name: 'actor_kind',
    type: 'varchar',
    length: 20,
    comment: '操作者種類',
  })
  actorKind!: 'employee' | 'super_user' | 'operator' | 'system';

  @Column({ name: 'source', type: 'varchar', length: 20, comment: '操作來源' })
  source!: 'http' | 'repl' | 'migration' | 'worker';

  @Column({
    name: 'module_key',
    type: 'varchar',
    length: 50,
    charset: 'ascii',
    collation: 'ascii_bin',
    nullable: true,
    comment: '子功能代碼',
  })
  moduleKey!: string | null;

  @Column({
    name: 'request_id',
    type: 'varchar',
    length: 64,
    nullable: true,
    comment: '請求追蹤 ID',
  })
  requestId!: string | null;

  @Column({ name: 'changes', type: 'json', comment: '欄位異動集合' })
  changes!: Record<string, [unknown, unknown]>;

  @Column({
    name: 'before_snapshot',
    type: 'json',
    nullable: true,
    comment: '異動前快照',
  })
  beforeSnapshot!: Record<string, unknown> | null;

  @Column({
    name: 'after_snapshot',
    type: 'json',
    nullable: true,
    comment: '異動後快照',
  })
  afterSnapshot!: Record<string, unknown> | null;

  @Column({
    name: 'description',
    type: 'varchar',
    length: 500,
    nullable: true,
    comment: '描述',
  })
  description!: string | null;

  @Column({
    name: 'ip_address',
    type: 'varchar',
    length: 45,
    nullable: true,
    comment: '來源 IP',
  })
  ipAddress!: string | null;

  @Column({
    name: 'user_agent',
    type: 'text',
    nullable: true,
    comment: 'User-Agent',
  })
  userAgent!: string | null;
}
