import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AuditableEntity } from '#app/infrastructure/database/auditable.entity';
import { User } from '#app/features/users/entities/user.entity';

@Entity({ name: 'esign_documents', comment: '電子簽文件' })
@Index('uq_esign_documents_doc_number', ['docNumber'], { unique: true })
@Index('idx_esign_documents_creator_status_updated_id', [
  'createdByUserId',
  'status',
  'updatedAt',
  'id',
])
@Index('idx_esign_documents_sign_start_at', ['signStartAt'])
@Index('idx_esign_documents_sign_end_at', ['signEndAt'])
@Index('idx_esign_documents_initiated_at', ['initiatedAt'])
@Index('idx_esign_documents_completed_at', ['completedAt'])
@Index('idx_esign_documents_stopped_at', ['stoppedAt'])
@Index('idx_esign_documents_created_at', ['createdAt'])
@Index('idx_esign_documents_updated_at', ['updatedAt'])
@Index('idx_esign_documents_deleted_at', ['deletedAt'])
export class EsignDocument extends AuditableEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', comment: '文件流水號' })
  id!: number;

  @Column({
    name: 'doc_number',
    type: 'char',
    length: 36,
    charset: 'ascii',
    collation: 'ascii_bin',
    comment: '文件 UUID',
  })
  docNumber!: string;

  @Column({ type: 'varchar', length: 200, comment: '文件名稱' })
  title!: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'draft',
    comment: '文件狀態',
  })
  status!: string;

  @Column({
    name: 'created_by_user_id',
    type: 'bigint',
    comment: '建立人 ID',
  })
  createdByUserId!: number;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'created_by_user_id',
    foreignKeyConstraintName: 'fk_esign_documents_creator',
  })
  createdByUser?: User;

  @Column({
    name: 'sign_start_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
    comment: '簽署開始時間',
  })
  signStartAt?: Date;

  @Column({
    name: 'sign_end_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
    comment: '簽署截止時間',
  })
  signEndAt?: Date;

  @Column({
    name: 'signing_payload_json',
    type: 'json',
    nullable: true,
    comment: '固定簽署 payload',
  })
  signingPayloadJson?: Record<string, unknown>;

  @Column({
    name: 'signing_payload_sha256',
    type: 'char',
    length: 64,
    charset: 'ascii',
    collation: 'ascii_bin',
    nullable: true,
    comment: '簽署 payload SHA-256',
  })
  signingPayloadSha256?: string;

  @Column({
    name: 'initiated_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
    comment: '發起時間',
  })
  initiatedAt?: Date;

  @Column({
    name: 'completed_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
    comment: '完成時間',
  })
  completedAt?: Date;

  @Column({
    name: 'stopped_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
    comment: '停止時間',
  })
  stoppedAt?: Date;

  @Column({
    name: 'stop_reason',
    type: 'varchar',
    length: 500,
    nullable: true,
    comment: '停止原因',
  })
  stopReason?: string;

  @Column({
    name: 'watermark_enabled',
    type: 'boolean',
    default: false,
    comment: '是否添加浮水印',
  })
  watermarkEnabled!: boolean;

  @Column({
    name: 'allow_reject',
    type: 'boolean',
    default: true,
    comment: '是否允許拒絕簽署',
  })
  allowReject!: boolean;
}
