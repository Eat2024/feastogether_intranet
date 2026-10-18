import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { EsignNotificationBatch } from './esign-notification-batch.entity';
import { EsignSigner } from './esign-signer.entity';

@Entity({ name: 'esign_notification_logs', comment: '通知明細' })
@Check('chk_esign_notification_logs_channel', "`channel` = 'email'")
@Check(
  'chk_esign_notification_logs_result',
  "`result` IN ('pending','processing','delivered','failed')",
)
@Index(
  'uq_esign_notification_logs_batch_signer_channel',
  ['batchId', 'signerId', 'channel'],
  { unique: true },
)
@Index('idx_esign_notification_logs_batch_id', ['batchId'])
@Index('idx_esign_notification_logs_signer_id', ['signerId'])
@Index('idx_esign_notification_logs_result', ['result'])
@Index('idx_esign_notification_logs_created_at', ['createdAt'])
@Index('idx_esign_notification_logs_completed_at', ['completedAt'])
@Index('idx_esign_notification_logs_next_attempt_at', ['nextAttemptAt'])
@Index('idx_esign_notification_logs_processing_started_at', [
  'processingStartedAt',
])
@Index('idx_esign_notification_logs_result_next_attempt_id', [
  'result',
  'nextAttemptAt',
  'id',
])
export class EsignNotificationLog {
  @PrimaryGeneratedColumn({ type: 'bigint', comment: '通知明細流水號' })
  id!: number;

  @Column({ name: 'batch_id', type: 'bigint', comment: '通知批次 ID' })
  batchId!: number;

  @ManyToOne(() => EsignNotificationBatch, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'batch_id',
    foreignKeyConstraintName: 'fk_esign_notification_logs_batch',
  })
  batch?: EsignNotificationBatch;

  @Column({ name: 'signer_id', type: 'bigint', comment: '簽署人 ID' })
  signerId!: number;

  @ManyToOne(() => EsignSigner, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'signer_id',
    foreignKeyConstraintName: 'fk_esign_notification_logs_signer',
  })
  signer?: EsignSigner;

  @Column({ type: 'varchar', length: 20, comment: '通知管道' })
  channel!: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'pending',
    comment: '通知結果',
  })
  result!: string;

  @Column({
    name: 'error_code',
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: '穩定錯誤碼',
  })
  errorCode?: string | null;

  @Column({
    name: 'attempt_count',
    type: 'int',
    unsigned: true,
    default: 0,
    comment: '寄送嘗試次數',
  })
  attemptCount!: number;

  @Column({
    name: 'next_attempt_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
    comment: '下次可重試時間',
  })
  nextAttemptAt?: Date | null;

  @Column({
    name: 'processing_started_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
    comment: '本次處理開始時間',
  })
  processingStartedAt?: Date | null;

  @Column({
    name: 'completed_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
    comment: '完成時間',
  })
  completedAt?: Date;

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
    precision: 6,
    comment: '建立時間',
  })
  createdAt!: Date;
}
