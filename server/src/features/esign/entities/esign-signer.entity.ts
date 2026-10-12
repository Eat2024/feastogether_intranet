import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserAuditableEntity } from '#app/infrastructure/database/user-auditable.entity';
import { User } from '#app/features/users/entities/user.entity';
import { EsignDocument } from './esign-document.entity';

@Entity({ name: 'esign_signers', comment: '文件簽署人' })
@Check(
  'chk_esign_signers_identity',
  "(`signer_type` = 'user' AND `user_id` IS NOT NULL AND `email` IS NULL AND `empid_snapshot` IS NOT NULL) OR (`signer_type` = 'email' AND `user_id` IS NULL AND `email` IS NOT NULL AND `empid_snapshot` IS NULL)",
)
@Index('uq_esign_signers_document_user', ['documentId', 'userId'], {
  unique: true,
})
@Index('uq_esign_signers_document_email', ['documentId', 'email'], {
  unique: true,
})
@Index('idx_esign_signers_user_status_document', [
  'userId',
  'status',
  'documentId',
])
@Index('idx_esign_signers_document_status_sort_id', [
  'documentId',
  'status',
  'sortOrder',
  'id',
])
@Index('idx_esign_signers_signed_at', ['signedAt'])
@Index('idx_esign_signers_rejected_at', ['rejectedAt'])
@Index('idx_esign_signers_created_at', ['createdAt'])
@Index('idx_esign_signers_updated_at', ['updatedAt'])
@Index('idx_esign_signers_deleted_at', ['deletedAt'])
export class EsignSigner extends UserAuditableEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', comment: '簽署人流水號' })
  id!: number;

  @Column({ name: 'document_id', type: 'bigint', comment: '文件 ID' })
  documentId!: number;

  @ManyToOne(() => EsignDocument, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'document_id',
    foreignKeyConstraintName: 'fk_esign_signers_document',
  })
  document?: EsignDocument;

  @Column({
    name: 'signer_type',
    type: 'varchar',
    length: 20,
    comment: '簽署人類型',
  })
  signerType!: string;

  @Column({
    name: 'user_id',
    type: 'bigint',
    nullable: true,
    comment: '員工 ID',
  })
  userId?: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'fk_esign_signers_user',
  })
  user?: User;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: '正規化外部 Email',
  })
  email?: string;

  @Column({
    name: 'empid_snapshot',
    type: 'varchar',
    length: 32,
    nullable: true,
    comment: '員編快照',
  })
  empidSnapshot?: string;

  @Column({
    name: 'name_snapshot',
    type: 'varchar',
    length: 100,
    comment: '姓名快照',
  })
  nameSnapshot!: string;

  @Column({
    name: 'department_snapshot',
    type: 'varchar',
    length: 150,
    nullable: true,
    comment: '部門快照',
  })
  departmentSnapshot?: string;

  @Column({
    name: 'title_snapshot',
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: '職稱快照',
  })
  titleSnapshot?: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'pending',
    comment: '簽署狀態',
  })
  status!: string;

  @Column({
    name: 'signed_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
    comment: '簽署時間',
  })
  signedAt?: Date;

  @Column({
    name: 'rejected_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
    comment: '拒絕時間',
  })
  rejectedAt?: Date;

  @Column({
    name: 'reject_reason',
    type: 'varchar',
    length: 500,
    nullable: true,
    comment: '拒絕原因',
  })
  rejectReason?: string;

  @Column({ name: 'sort_order', type: 'int', default: 0, comment: '排序' })
  sortOrder!: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'created_by_user_id',
    foreignKeyConstraintName: 'fk_esign_signers_created_by',
  })
  createdByUser?: User;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'updated_by_user_id',
    foreignKeyConstraintName: 'fk_esign_signers_updated_by',
  })
  updatedByUser?: User;
}
