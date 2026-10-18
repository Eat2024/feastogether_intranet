import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { EsignDocument } from './esign-document.entity';

@Entity({ name: 'esign_verification_records', comment: '公開驗證證據' })
@Index('uq_esign_verification_records_document_id', ['documentId'], {
  unique: true,
})
@Index('uq_esign_verification_records_public_id', ['publicId'], {
  unique: true,
})
@Index('idx_esign_verification_records_manifest_sha256', ['manifestSha256'])
@Index('idx_esign_verification_records_final_pdf_sha256', ['finalPdfSha256'])
@Index('idx_esign_verification_records_status', ['status'])
@Index('idx_esign_verification_records_issued_at', ['issuedAt'])
@Index('idx_esign_verification_records_revoked_at', ['revokedAt'])
@Index('idx_esign_verification_records_created_at', ['createdAt'])
export class EsignVerificationRecord {
  @PrimaryGeneratedColumn({ type: 'bigint', comment: '驗證紀錄流水號' })
  id!: number;

  @Column({
    name: 'document_id',
    type: 'bigint',
    comment: '文件 ID',
  })
  documentId!: number;

  @ManyToOne(() => EsignDocument, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'document_id',
    foreignKeyConstraintName: 'fk_esign_verification_records_document',
  })
  document?: EsignDocument;

  @Column({
    name: 'public_id',
    type: 'char',
    length: 36,
    charset: 'ascii',
    collation: 'ascii_bin',
    comment: '公開驗證 UUID',
  })
  publicId!: string;

  @Column({ name: 'manifest_json', type: 'json', comment: '驗證 manifest' })
  manifestJson!: Record<string, unknown>;

  @Column({
    name: 'manifest_sha256',
    type: 'char',
    length: 64,
    charset: 'ascii',
    collation: 'ascii_bin',
    comment: 'manifest SHA-256',
  })
  manifestSha256!: string;

  @Column({
    name: 'final_pdf_sha256',
    type: 'char',
    length: 64,
    charset: 'ascii',
    collation: 'ascii_bin',
    nullable: true,
    comment: '最終 PDF SHA-256',
  })
  finalPdfSha256!: string | null;

  @Column({
    name: 'audit_root_hash',
    type: 'char',
    length: 64,
    charset: 'ascii',
    collation: 'ascii_bin',
    comment: '稽核鏈 root hash',
  })
  auditRootHash!: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'valid',
    comment: '驗證狀態',
  })
  status!: string;

  @Column({
    name: 'issued_at',
    type: 'datetime',
    precision: 6,
    comment: '核發時間',
  })
  issuedAt!: Date;

  @Column({
    name: 'revoked_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
    comment: '撤銷時間',
  })
  revokedAt?: Date;

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
    precision: 6,
    comment: '建立時間',
  })
  createdAt!: Date;
}
