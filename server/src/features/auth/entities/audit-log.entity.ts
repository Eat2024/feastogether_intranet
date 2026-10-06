import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '#app/infrastructure/database/base.entity';

/** audit_logs — 通用稽核歷史紀錄（append-only，不可更新/刪除）。 */
@Entity({ name: 'audit_logs', comment: '通用稽核歷史紀錄' })
@Index('idx_audit_logs_entity', ['entityType', 'entityId', 'createdAt', 'id'])
@Index('idx_audit_logs_actor', ['actorUserId', 'createdAt', 'id'])
@Index('idx_audit_logs_action', ['action', 'createdAt', 'id'])
export class AuditLog extends BaseEntity {
  @PrimaryGeneratedColumn({ name: 'id', type: 'bigint', comment: '流水號' })
  id!: number;

  @Column({
    name: 'action',
    type: 'varchar',
    length: 80,
    comment: '稽核動作',
  })
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
    comment: '操作者使用者 ID',
  })
  actorUserId?: number;

  @Column({
    name: 'changes',
    type: 'json',
    comment: '欄位異動集合，格式為 field: [before, after]',
  })
  changes!: Record<string, [unknown, unknown]>;

  @Column({
    name: 'before_snapshot',
    type: 'json',
    nullable: true,
    comment: '異動前快照',
  })
  beforeSnapshot?: Record<string, unknown> | null;

  @Column({
    name: 'after_snapshot',
    type: 'json',
    nullable: true,
    comment: '異動後快照',
  })
  afterSnapshot?: Record<string, unknown> | null;

  @Column({
    name: 'description',
    type: 'varchar',
    length: 500,
    nullable: true,
    comment: '描述',
  })
  description?: string;

  @Column({
    name: 'ip_address',
    type: 'varchar',
    length: 45,
    nullable: true,
    comment: '來源 IP',
  })
  ipAddress?: string;

  @Column({
    name: 'user_agent',
    type: 'text',
    nullable: true,
    comment:
      'User-Agent（TEXT：真實 UA 可能超過 500 字，避免 strict mode 截斷/報錯）',
  })
  userAgent?: string;
}
