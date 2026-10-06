import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { AuditLog } from './audit-log.entity';
import { BaseEntity } from '#app/infrastructure/database/base.entity';

/** audit_log_targets — 稽核紀錄查詢目標（append-only，不可更新/刪除）。 */
@Entity({ name: 'audit_log_targets', comment: '稽核紀錄查詢目標' })
@Index('idx_audit_log_targets_lookup', [
  'targetType',
  'targetId',
  'targetKind',
  'auditLogId',
])
@Unique('uq_audit_log_targets_unique', [
  'auditLogId',
  'targetKind',
  'targetType',
  'targetId',
])
export class AuditLogTarget extends BaseEntity {
  @PrimaryGeneratedColumn({ name: 'id', type: 'bigint', comment: '流水號' })
  id!: number;

  @Column({
    name: 'audit_log_id',
    type: 'bigint',
    comment: '稽核紀錄 ID（FK→audit_logs.id）',
  })
  auditLogId!: number;

  @ManyToOne(() => AuditLog, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'audit_log_id' })
  auditLog?: AuditLog;

  @Column({
    name: 'target_kind',
    type: 'varchar',
    length: 20,
    comment: '目標類型：primary / associated',
  })
  targetKind!: string;

  @Column({
    name: 'target_type',
    type: 'varchar',
    length: 80,
    comment: '查詢目標型別',
  })
  targetType!: string;

  @Column({
    name: 'target_id',
    type: 'varchar',
    length: 64,
    comment: '查詢目標 ID',
  })
  targetId!: string;
}
