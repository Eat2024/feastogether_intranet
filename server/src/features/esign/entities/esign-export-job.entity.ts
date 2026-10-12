import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '#app/features/users/entities/user.entity';
import { EsignDocument } from './esign-document.entity';

@Entity({ name: 'esign_export_jobs', comment: '匯出工作' })
@Index('idx_esign_export_jobs_document_id', ['documentId'])
@Index('idx_esign_export_jobs_creator_status_created_id', [
  'createdByUserId',
  'status',
  'createdAt',
  'id',
])
@Index('idx_esign_export_jobs_status', ['status'])
@Index('idx_esign_export_jobs_created_at', ['createdAt'])
@Index('idx_esign_export_jobs_updated_at', ['updatedAt'])
@Index('idx_esign_export_jobs_completed_at', ['completedAt'])
export class EsignExportJob {
  @PrimaryGeneratedColumn({ type: 'bigint', comment: '匯出工作流水號' })
  id!: number;

  @Column({
    name: 'export_type',
    type: 'varchar',
    length: 30,
    comment: '匯出類型',
  })
  exportType!: string;

  @Column({
    name: 'document_id',
    type: 'bigint',
    nullable: true,
    comment: '文件 ID',
  })
  documentId?: number;

  @ManyToOne(() => EsignDocument, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'document_id',
    foreignKeyConstraintName: 'fk_esign_export_jobs_document',
  })
  document?: EsignDocument;

  @Column({
    name: 'created_by_user_id',
    type: 'bigint',
    comment: '建立員工 ID',
  })
  createdByUserId!: number;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'created_by_user_id',
    foreignKeyConstraintName: 'fk_esign_export_jobs_user',
  })
  createdByUser?: User;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'pending',
    comment: '工作狀態',
  })
  status!: string;

  @Column({
    name: 'scope_description',
    type: 'varchar',
    length: 255,
    comment: '匯出範圍說明',
  })
  scopeDescription!: string;

  @Column({
    name: 'record_count',
    type: 'bigint',
    unsigned: true,
    nullable: true,
    comment: '匯出筆數',
  })
  recordCount?: number;

  @Column({
    name: 'failure_code',
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: '失敗錯誤碼',
  })
  failureCode?: string;

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

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'datetime',
    precision: 6,
    comment: '更新時間',
  })
  updatedAt!: Date;
}
