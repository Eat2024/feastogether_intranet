import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '#app/features/users/entities/user.entity';
import { EsignDocument } from './esign-document.entity';

@Entity({ name: 'esign_notification_batches', comment: '通知批次' })
@Index('idx_esign_notification_batches_document_id', ['documentId'])
@Index('idx_esign_notification_batches_created_at', ['createdAt'])
export class EsignNotificationBatch {
  @PrimaryGeneratedColumn({ type: 'bigint', comment: '通知批次流水號' })
  id!: number;

  @Column({ name: 'document_id', type: 'bigint', comment: '文件 ID' })
  documentId!: number;

  @ManyToOne(() => EsignDocument, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'document_id',
    foreignKeyConstraintName: 'fk_esign_notification_batches_document',
  })
  document?: EsignDocument;

  @Column({
    name: 'filter_type',
    type: 'varchar',
    length: 20,
    comment: '通知篩選',
  })
  filterType!: string;

  @Column({
    name: 'target_count',
    type: 'int',
    unsigned: true,
    comment: '目標數量',
  })
  targetCount!: number;

  @Column({
    name: 'notified_by_user_id',
    type: 'bigint',
    nullable: true,
    comment: '通知操作員工 ID',
  })
  notifiedByUserId?: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'notified_by_user_id',
    foreignKeyConstraintName: 'fk_esign_notification_batches_user',
  })
  notifiedByUser?: User;

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
    precision: 6,
    comment: '建立時間',
  })
  createdAt!: Date;
}
