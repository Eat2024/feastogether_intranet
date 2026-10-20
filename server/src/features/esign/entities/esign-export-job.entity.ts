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

export interface ExportSnapshotEntry {
  recordId: number;
  signerPublicId: string;
  fileName: string;
  file?: ExportResolvedFile;
}
export interface ExportResolvedFile {
  recordId: number;
  fileId: number;
  objectKey: string;
  objectVersion?: string;
  sha256: string;
  fileSize: number;
}
export interface ExportStaging {
  generation: string;
  objectKey?: string;
  objectVersion?: string;
  uploadId?: string;
}

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
@Index('uq_esign_export_jobs_public_id', ['publicId'], { unique: true })
@Index('idx_esign_exports_reuse', [
  'documentId',
  'exportType',
  'status',
  'expiresAt',
  'id',
])
@Index('idx_esign_exports_retry', ['status', 'nextAttemptAt', 'id'])
@Index('idx_esign_export_jobs_lease_expires_at', ['leaseExpiresAt'])
@Index('idx_esign_export_jobs_snapshot_at', ['snapshotAt'])
@Index('idx_esign_export_jobs_expires_at', ['expiresAt'])
@Index('idx_esign_export_jobs_next_attempt_at', ['nextAttemptAt'])
export class EsignExportJob {
  @Column({
    name: 'public_id',
    type: 'char',
    nullable: true,
    comment: '公開工作 UUID',
    length: 36,
  })
  publicId?: string | null;

  @Column({
    name: 'snapshot_at',
    type: 'datetime',
    nullable: true,
    comment: '固定快照時間',
    precision: 6,
  })
  snapshotAt?: Date | null;

  @Column({
    name: 'snapshot_json',
    type: 'json',
    nullable: true,
    comment: '不可變簽署快照',
  })
  snapshotJson?: ExportSnapshotEntry[] | null;

  @Column({
    name: 'snapshot_sha256',
    type: 'char',
    nullable: true,
    comment: '快照 SHA-256',
    length: 64,
  })
  snapshotSha256?: string | null;

  @Column({
    name: 'resolved_files_json',
    type: 'json',
    nullable: true,
    comment: '已固定來源副本',
  })
  resolvedFilesJson?: ExportResolvedFile[] | null;

  @Column({
    name: 'processed_count',
    type: 'int',
    nullable: true,
    comment: '當次處理數',
    unsigned: true,
  })
  processedCount?: number | null;

  @Column({
    name: 'waiting_count',
    type: 'int',
    nullable: true,
    comment: '等待副本數',
    unsigned: true,
  })
  waitingCount?: number | null;

  @Column({
    name: 'expires_at',
    type: 'datetime',
    nullable: true,
    comment: '成果到期時間',
    precision: 6,
  })
  expiresAt?: Date | null;

  @Column({
    name: 'lease_token',
    type: 'char',
    nullable: true,
    comment: '工作 generation',
    length: 36,
  })
  leaseToken?: string | null;

  @Column({
    name: 'lease_expires_at',
    type: 'datetime',
    nullable: true,
    comment: '租約到期時間',
    precision: 6,
  })
  leaseExpiresAt?: Date | null;

  @Column({
    name: 'attempt_count',
    type: 'int',
    nullable: true,
    comment: '嘗試次數',
    unsigned: true,
  })
  attemptCount?: number | null;

  @Column({
    name: 'next_attempt_at',
    type: 'datetime',
    nullable: true,
    comment: '再次排入時間',
    precision: 6,
  })
  nextAttemptAt?: Date | null;

  @Column({
    name: 'staging_json',
    type: 'json',
    nullable: true,
    comment: '暫存成果位置',
  })
  stagingJson?: ExportStaging | null;

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
  failureCode?: string | null;

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
