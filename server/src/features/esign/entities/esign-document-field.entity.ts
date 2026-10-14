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
import { EsignSigner } from './esign-signer.entity';

@Entity({ name: 'esign_document_fields', comment: '文件簽署欄位' })
@Check('chk_esign_document_fields_type', "`field_type` IN ('signature','date')")
@Check('chk_esign_document_fields_page', '`page_number` >= 1')
@Check(
  'chk_esign_document_fields_bounds',
  '`x_percent` >= 0 AND `x_percent` < 100 AND `y_percent` >= 0 AND `y_percent` < 100 AND `width_percent` > 0 AND `height_percent` > 0 AND `x_percent` + `width_percent` <= 100 AND `y_percent` + `height_percent` <= 100',
)
@Index('idx_esign_document_fields_doc_page_sort_id', [
  'documentId',
  'pageNumber',
  'sortOrder',
  'id',
])
@Index('idx_esign_document_fields_created_at', ['createdAt'])
@Index('idx_esign_document_fields_signer_id', ['signerId'])
@Index('idx_esign_document_fields_updated_at', ['updatedAt'])
@Index('idx_esign_document_fields_deleted_at', ['deletedAt'])
export class EsignDocumentField extends UserAuditableEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', comment: '欄位流水號' })
  id!: number;

  @Column({ name: 'document_id', type: 'bigint', comment: '文件 ID' })
  documentId!: number;

  @ManyToOne(() => EsignDocument, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'document_id',
    foreignKeyConstraintName: 'fk_esign_document_fields_document',
  })
  document?: EsignDocument;

  @Column({
    name: 'signer_id',
    type: 'bigint',
    nullable: true,
    comment: '欄位所屬簽署人 ID',
  })
  signerId?: number;

  @ManyToOne(() => EsignSigner, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'signer_id',
    foreignKeyConstraintName: 'fk_esign_document_fields_signer',
  })
  signer?: EsignSigner;

  @Column({
    name: 'field_type',
    type: 'varchar',
    length: 20,
    comment: '欄位類型',
  })
  fieldType!: string;

  @Column({ name: 'page_number', type: 'int', unsigned: true, comment: '頁碼' })
  pageNumber!: number;

  @Column({
    name: 'x_percent',
    type: 'decimal',
    precision: 6,
    scale: 3,
    comment: 'X 百分比',
  })
  xPercent!: string;

  @Column({
    name: 'y_percent',
    type: 'decimal',
    precision: 6,
    scale: 3,
    comment: 'Y 百分比',
  })
  yPercent!: string;

  @Column({
    name: 'width_percent',
    type: 'decimal',
    precision: 6,
    scale: 3,
    comment: '寬度百分比',
  })
  widthPercent!: string;

  @Column({
    name: 'height_percent',
    type: 'decimal',
    precision: 6,
    scale: 3,
    comment: '高度百分比',
  })
  heightPercent!: string;

  @Column({ name: 'sort_order', type: 'int', default: 0, comment: '排序' })
  sortOrder!: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'created_by_user_id',
    foreignKeyConstraintName: 'fk_esign_document_fields_created_by',
  })
  createdByUser?: User;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'updated_by_user_id',
    foreignKeyConstraintName: 'fk_esign_document_fields_updated_by',
  })
  updatedByUser?: User;
}
