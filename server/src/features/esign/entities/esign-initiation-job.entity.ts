import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AuditableEntity } from '#app/infrastructure/database/auditable.entity';
import { User } from '#app/features/users/entities/user.entity';
import { EsignDocument } from './esign-document.entity';
import type { InitiateDocumentDto } from '../dto/initiation.dto';

export type InitiationJobStatus =
  | 'queued'
  | 'processing'
  | 'succeeded'
  | 'failed';
export type InitiationJobStage =
  | 'queued'
  | 'resolving'
  | 'validating'
  | 'committing'
  | 'completed'
  | 'failed';
export interface InitiationDocumentVersion {
  updatedAt: string;
  sourceFileId: number;
  sourceSha256: string;
  sourceObjectVersion: string | null;
}
export interface InitiationIssue {
  inputIndex: number;
  employeeNo?: string;
  code: string;
}

@Entity({ name: 'esign_initiation_jobs', comment: '背景發起簽署工作' })
@Check(
  'chk_esign_initiation_jobs_status',
  "`status` IN ('queued','processing','succeeded','failed')",
)
@Check(
  'chk_esign_initiation_jobs_stage',
  "`stage` IN ('queued','resolving','validating','committing','completed','failed')",
)
@Check(
  'chk_esign_initiation_jobs_counts',
  '`total_count` > 0 AND `processed_count` >= 0 AND `processed_count` <= `total_count` AND `attempt_count` BETWEEN 0 AND 3 AND `issue_count` >= 0',
)
@Check(
  'chk_esign_initiation_jobs_input',
  "`status` NOT IN ('queued','processing') OR (`input_json` IS NOT NULL AND `document_version_json` IS NOT NULL AND `input_purged_at` IS NULL)",
)
@Check(
  'chk_esign_initiation_jobs_lease',
  "(`status` = 'processing' AND `lease_token` IS NOT NULL AND `lease_expires_at` IS NOT NULL) OR (`status` <> 'processing' AND `lease_token` IS NULL AND `lease_expires_at` IS NULL)",
)
@Check(
  'chk_esign_initiation_jobs_completion',
  "(`status` IN ('queued','processing') AND `completed_at` IS NULL) OR (`status` IN ('succeeded','failed') AND `completed_at` IS NOT NULL)",
)
@Check(
  'chk_esign_initiation_jobs_result',
  "(`status` = 'succeeded' AND `stage` = 'completed' AND `error_code` IS NULL) OR (`status` = 'failed' AND `stage` = 'failed' AND `error_code` IS NOT NULL) OR (`status` = 'queued' AND `stage` = 'queued') OR (`status` = 'processing' AND `stage` IN ('resolving','validating','committing'))",
)
@Check('chk_esign_initiation_jobs_deadline', '`deadline_at` > `accepted_at`')
@Check(
  'chk_esign_initiation_jobs_actor',
  "(`created_by_actor_kind`='employee' AND `created_by_user_id` IS NOT NULL) OR (`created_by_actor_kind`='super_user' AND `created_by_user_id` IS NULL)",
)
@Index('uq_esign_initiation_jobs_public', ['publicId'], { unique: true })
@Index('uq_esign_initiation_jobs_request', ['documentId', 'requestKey'], {
  unique: true,
})
@Index('uq_esign_initiation_jobs_active', ['activeDocumentId'], {
  unique: true,
})
@Index('idx_esign_initiation_jobs_document', ['documentId', 'id'])
@Index('idx_esign_initiation_jobs_retry', ['status', 'nextAttemptAt', 'id'])
@Index('idx_esign_initiation_jobs_lease', ['status', 'leaseExpiresAt', 'id'])
@Index('idx_esign_initiation_jobs_completed', ['status', 'completedAt', 'id'])
export class EsignInitiationJob extends AuditableEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', comment: '工作流水號' })
  id!: number;

  @Column({
    name: 'public_id',
    type: 'char',
    comment: '工作公開 UUID',
    length: 36,
    charset: 'ascii',
    collation: 'ascii_bin',
  })
  publicId!: string;

  @Column({ name: 'document_id', type: 'bigint', comment: '文件 ID' })
  documentId!: number;

  @Column({
    name: 'created_by_user_id',
    nullable: true,
    type: 'bigint',
    comment: '原發起者 ID',
  })
  createdByUserId!: number | null;

  @Column({
    name: 'created_by_actor_kind',
    type: 'varchar',
    length: 20,
    default: 'employee',
    comment: '實際提交操作者種類',
  })
  createdByActorKind!: 'employee' | 'super_user';

  @Column({
    name: 'request_key',
    type: 'char',
    comment: '冪等請求 UUID',
    length: 36,
    charset: 'ascii',
    collation: 'ascii_bin',
  })
  requestKey!: string;

  @Column({
    name: 'request_hash',
    type: 'char',
    comment: '正規化請求 SHA256',
    length: 64,
    charset: 'ascii',
    collation: 'ascii_bin',
  })
  requestHash!: string;

  @Column({
    name: 'parent_job_id',
    type: 'bigint',
    comment: '人工重試來源工作 ID',
    nullable: true,
  })
  parentJobId!: number | null;

  @Column({
    name: 'input_json',
    type: 'json',
    comment: '本次確認的完整輸入',
    nullable: true,
    select: false,
  })
  inputJson!: InitiateDocumentDto | null;

  @Column({
    name: 'document_version_json',
    type: 'json',
    comment: '受理時文件與原檔版本',
    nullable: true,
    select: false,
  })
  documentVersionJson!: InitiationDocumentVersion | null;

  @Column({
    name: 'status',
    type: 'varchar',
    comment: '工作狀態',
    length: 16,
    default: 'queued',
  })
  status!: InitiationJobStatus;

  @Column({
    name: 'stage',
    type: 'varchar',
    comment: '工作階段',
    length: 16,
    default: 'queued',
  })
  stage!: InitiationJobStage;

  @Column({ name: 'total_count', type: 'int', comment: '本次名單總人數' })
  totalCount!: number;

  @Column({
    name: 'processed_count',
    type: 'int',
    comment: '本輪已查核人數',
    default: 0,
  })
  processedCount!: number;

  @Column({
    name: 'attempt_count',
    type: 'int',
    comment: '已取得執行權次數',
    default: 0,
  })
  attemptCount!: number;

  @Column({
    name: 'next_attempt_at',
    type: 'datetime',
    comment: '下次允許執行時間',
    nullable: true,
    precision: 6,
  })
  nextAttemptAt!: Date | null;

  @Column({
    name: 'lease_token',
    type: 'char',
    comment: '本輪租約 UUID',
    length: 36,
    nullable: true,
    charset: 'ascii',
    collation: 'ascii_bin',
  })
  leaseToken!: string | null;

  @Column({
    name: 'lease_expires_at',
    type: 'datetime',
    comment: '本輪租約截止時間',
    nullable: true,
    precision: 6,
  })
  leaseExpiresAt!: Date | null;

  @Column({
    name: 'accepted_at',
    type: 'datetime',
    comment: '可靠受理時間',
    precision: 6,
  })
  acceptedAt!: Date;

  @Column({
    name: 'deadline_at',
    type: 'datetime',
    comment: '整份工作的最晚提交時間',
    precision: 6,
  })
  deadlineAt!: Date;

  @Column({
    name: 'last_progress_at',
    type: 'datetime',
    comment: '最新進度時間',
    nullable: true,
    precision: 6,
  })
  lastProgressAt!: Date | null;

  @Column({
    name: 'started_at',
    type: 'datetime',
    comment: '首次執行時間',
    nullable: true,
    precision: 6,
  })
  startedAt!: Date | null;

  @Column({
    name: 'completed_at',
    type: 'datetime',
    comment: '終態時間',
    nullable: true,
    precision: 6,
  })
  completedAt!: Date | null;

  @Column({
    name: 'error_code',
    type: 'varchar',
    comment: '穩定分類錯誤碼',
    length: 80,
    nullable: true,
  })
  errorCode!: string | null;

  @Column({
    name: 'retryable',
    type: 'boolean',
    comment: '是否可人工重試',
    default: false,
  })
  retryable!: boolean;

  @Column({
    name: 'issue_count',
    type: 'int',
    comment: '人員問題總數',
    default: 0,
  })
  issueCount!: number;

  @Column({
    name: 'issues_json',
    type: 'json',
    comment: '人員問題分類清單',
    nullable: true,
    select: false,
  })
  issuesJson!: InitiationIssue[] | null;

  @Column({
    name: 'input_purged_at',
    type: 'datetime',
    comment: '終態敏感明細清理時間',
    nullable: true,
    precision: 6,
  })
  inputPurgedAt!: Date | null;

  @Column({
    name: 'active_document_id',
    type: 'bigint',
    nullable: true,
    asExpression:
      "CASE WHEN `status` IN ('queued','processing') THEN `document_id` ELSE NULL END",
    generatedType: 'STORED',
    select: false,
    insert: false,
    update: false,
    comment: '每份文件唯一非終態工作',
  })
  activeDocumentId!: number | null;

  @ManyToOne(() => EsignDocument, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'document_id',
    foreignKeyConstraintName: 'fk_esign_initiation_jobs_document',
  })
  document?: EsignDocument;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({
    name: 'created_by_user_id',
    foreignKeyConstraintName: 'fk_esign_initiation_jobs_creator',
  })
  createdByUser?: User;

  @ManyToOne(() => EsignInitiationJob, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'parent_job_id',
    foreignKeyConstraintName: 'fk_esign_initiation_jobs_parent',
  })
  parentJob?: EsignInitiationJob;
}
