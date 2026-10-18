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
import { EsignDocument } from './esign-document.entity';
import { EsignDocumentField } from './esign-document-field.entity';
import { EsignExportJob } from './esign-export-job.entity';
import { EsignSignatureRecord } from './esign-signature-record.entity';
import { EsignVerificationRecord } from './esign-verification-record.entity';

@Entity({ name: 'esign_file_objects', comment: '私有物件儲存 metadata' })
@Index('uq_esign_file_objects_object_key', ['objectKey'], { unique: true })
@Check(
  'chk_esign_file_objects_owner',
  '`document_id` IS NOT NULL OR `signature_record_id` IS NOT NULL OR `verification_record_id` IS NOT NULL OR `export_job_id` IS NOT NULL',
)
@Check(
  'chk_esign_file_objects_signature_field',
  "(`file_purpose` = 'signature_png' AND `signature_record_id` IS NOT NULL AND `document_field_id` IS NOT NULL) OR (`file_purpose` <> 'signature_png' AND `document_field_id` IS NULL)",
)
@Check(
  'chk_esign_file_objects_completed_owner',
  "`file_purpose` <> 'completed_pdf' OR (((`document_id` IS NOT NULL AND `signature_record_id` IS NULL) OR (`document_id` IS NULL AND `signature_record_id` IS NOT NULL)) AND `document_field_id` IS NULL AND `verification_record_id` IS NULL AND `export_job_id` IS NULL)",
)
@Check(
  'chk_esign_file_objects_source_owner',
  "`file_purpose` <> 'source_pdf' OR (`document_id` IS NOT NULL AND `signature_record_id` IS NULL AND `document_field_id` IS NULL AND `verification_record_id` IS NULL AND `export_job_id` IS NULL)",
)
@Index(
  'uq_esign_file_objects_completed_signature',
  ['completedSignatureRecordId'],
  { unique: true },
)
@Index('idx_esign_file_objects_document_id', ['documentId'])
@Index('idx_esign_file_objects_signature_record_id', ['signatureRecordId'])
@Index('idx_esign_file_objects_document_field_id', ['documentFieldId'])
@Index(
  'uq_esign_file_objects_document_purpose',
  ['documentId', 'filePurpose'],
  { unique: true },
)
@Index(
  'uq_esign_file_objects_signature_field_purpose',
  ['signatureRecordId', 'documentFieldId', 'filePurpose'],
  { unique: true },
)
@Index('idx_esign_file_objects_verification_record_id', [
  'verificationRecordId',
])
@Index('idx_esign_file_objects_export_job_id', ['exportJobId'])
@Index('idx_esign_file_objects_file_purpose', ['filePurpose'])
@Index('idx_esign_file_objects_sha256', ['sha256'])
@Index('idx_esign_file_objects_archive_status', ['archiveStatus'])
@Index('idx_esign_file_objects_created_at', ['createdAt'])
export class EsignFileObject {
  @Column({
    name: 'completed_signature_record_id',
    type: 'bigint',
    nullable: true,
    asExpression:
      "CASE WHEN `file_purpose` = 'completed_pdf' THEN `signature_record_id` ELSE NULL END",
    generatedType: 'VIRTUAL',
    select: false,
    insert: false,
    update: false,
    comment: '個人完成檔唯一簽署證據 ID',
  })
  completedSignatureRecordId?: number;

  @PrimaryGeneratedColumn({ type: 'bigint', comment: '檔案 metadata 流水號' })
  id!: number;

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
    foreignKeyConstraintName: 'fk_esign_file_objects_document',
  })
  document?: EsignDocument;

  @Column({
    name: 'signature_record_id',
    type: 'bigint',
    nullable: true,
    comment: '簽署證據 ID',
  })
  signatureRecordId?: number;

  @ManyToOne(() => EsignSignatureRecord, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'signature_record_id',
    foreignKeyConstraintName: 'fk_esign_file_objects_signature',
  })
  signatureRecord?: EsignSignatureRecord;

  @Column({
    name: 'document_field_id',
    type: 'bigint',
    nullable: true,
    comment: '簽名圖對應文件欄位 ID',
  })
  documentFieldId?: number;

  @ManyToOne(() => EsignDocumentField, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'document_field_id',
    foreignKeyConstraintName: 'fk_esign_file_objects_document_field',
  })
  documentField?: EsignDocumentField;

  @Column({
    name: 'verification_record_id',
    type: 'bigint',
    nullable: true,
    comment: '驗證紀錄 ID',
  })
  verificationRecordId?: number;

  @ManyToOne(() => EsignVerificationRecord, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'verification_record_id',
    foreignKeyConstraintName: 'fk_esign_file_objects_verification',
  })
  verificationRecord?: EsignVerificationRecord;

  @Column({
    name: 'export_job_id',
    type: 'bigint',
    nullable: true,
    comment: '匯出工作 ID',
  })
  exportJobId?: number;

  @ManyToOne(() => EsignExportJob, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'export_job_id',
    foreignKeyConstraintName: 'fk_esign_file_objects_export',
  })
  exportJob?: EsignExportJob;

  @Column({
    name: 'file_purpose',
    type: 'varchar',
    length: 30,
    comment: '檔案用途',
  })
  filePurpose!: string;

  @Column({
    name: 'object_key',
    type: 'varchar',
    length: 500,
    collation: 'utf8mb4_bin',
    comment: '私有物件 key',
  })
  objectKey!: string;

  @Column({
    name: 'object_version',
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: '物件版本',
  })
  objectVersion?: string;

  @Column({
    name: 'original_file_name',
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: '原始檔名',
  })
  originalFileName?: string;

  @Column({
    name: 'mime_type',
    type: 'varchar',
    length: 100,
    comment: 'MIME type',
  })
  mimeType!: string;

  @Column({
    name: 'file_size',
    type: 'bigint',
    unsigned: true,
    comment: '檔案大小 bytes',
  })
  fileSize!: number;

  @Column({
    type: 'char',
    length: 64,
    charset: 'ascii',
    collation: 'ascii_bin',
    comment: '檔案 SHA-256',
  })
  sha256!: string;

  @Column({
    name: 'archive_status',
    type: 'varchar',
    length: 20,
    default: 'active',
    comment: '封存狀態',
  })
  archiveStatus!: string;

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
    precision: 6,
    comment: '建立時間',
  })
  createdAt!: Date;
}
