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
import { EsignSigner } from './esign-signer.entity';

@Entity({ name: 'esign_audit_events', comment: '不可變文件稽核事件' })
@Index('uq_esign_audit_events_event_hash', ['eventHash'], { unique: true })
@Index('idx_esign_audit_events_document_occurred_id', [
  'documentId',
  'occurredAt',
  'id',
])
@Index('idx_esign_audit_events_signer_id', ['signerId'])
@Index('idx_esign_audit_events_actor_user_id', ['actorUserId'])
@Index('idx_esign_audit_events_event_type', ['eventType'])
@Index('idx_esign_audit_events_request_id', ['requestId'])
@Index('idx_esign_audit_events_occurred_at', ['occurredAt'])
@Index('idx_esign_audit_events_created_at', ['createdAt'])
export class EsignAuditEvent {
  @PrimaryGeneratedColumn({ type: 'bigint', comment: '稽核事件流水號' })
  id!: number;

  @Column({ name: 'document_id', type: 'bigint', comment: '文件 ID' })
  documentId!: number;

  @ManyToOne(() => EsignDocument, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'document_id',
    foreignKeyConstraintName: 'fk_esign_audit_events_document',
  })
  document?: EsignDocument;

  @Column({
    name: 'signer_id',
    type: 'bigint',
    nullable: true,
    comment: '簽署人 ID',
  })
  signerId?: number;

  @ManyToOne(() => EsignSigner, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'signer_id',
    foreignKeyConstraintName: 'fk_esign_audit_events_signer',
  })
  signer?: EsignSigner;

  @Column({
    name: 'actor_user_id',
    type: 'bigint',
    nullable: true,
    comment: '操作員工 ID',
  })
  actorUserId?: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'actor_user_id',
    foreignKeyConstraintName: 'fk_esign_audit_events_actor',
  })
  actorUser?: User;

  @Column({
    name: 'event_type',
    type: 'varchar',
    length: 50,
    comment: '事件類型',
  })
  eventType!: string;

  @Column({
    name: 'occurred_at',
    type: 'datetime',
    precision: 6,
    comment: '事件發生時間',
  })
  occurredAt!: Date;

  @Column({
    name: 'previous_event_hash',
    type: 'char',
    length: 64,
    charset: 'ascii',
    collation: 'ascii_bin',
    nullable: true,
    comment: '前一事件 hash',
  })
  previousEventHash?: string;

  @Column({
    name: 'event_hash',
    type: 'char',
    length: 64,
    charset: 'ascii',
    collation: 'ascii_bin',
    comment: '事件 hash',
  })
  eventHash!: string;

  @Column({
    name: 'request_id',
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: '請求追蹤 ID',
  })
  requestId?: string;

  @Column({
    name: 'metadata_json',
    type: 'json',
    nullable: true,
    comment: '事件中繼資料',
  })
  metadataJson?: Record<string, unknown>;

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
    precision: 6,
    comment: '建立時間',
  })
  createdAt!: Date;
}
