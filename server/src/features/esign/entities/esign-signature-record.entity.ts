import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { EsignSigner } from './esign-signer.entity';

@Entity({ name: 'esign_signature_records', comment: '不可變簽署證據' })
@Index('uq_esign_signature_records_signer_id', ['signerId'], { unique: true })
@Index('uq_esign_signature_records_auth_event', ['authenticationEventId'], {
  unique: true,
})
@Index('idx_esign_signature_records_signing_payload_sha256', [
  'signingPayloadSha256',
])
@Index('idx_esign_signature_records_signed_at_utc', ['signedAtUtc'])
@Index('idx_esign_signature_records_created_at', ['createdAt'])
export class EsignSignatureRecord {
  @PrimaryGeneratedColumn({ type: 'bigint', comment: '簽署證據流水號' })
  id!: number;

  @Column({
    name: 'signer_id',
    type: 'bigint',
    comment: '簽署人 ID',
  })
  signerId!: number;

  @ManyToOne(() => EsignSigner, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'signer_id',
    foreignKeyConstraintName: 'fk_esign_signature_records_signer',
  })
  signer?: EsignSigner;

  @Column({
    name: 'document_sha256',
    type: 'char',
    length: 64,
    charset: 'ascii',
    collation: 'ascii_bin',
    comment: '文件 SHA-256',
  })
  documentSha256!: string;

  @Column({
    name: 'signing_payload_sha256',
    type: 'char',
    length: 64,
    charset: 'ascii',
    collation: 'ascii_bin',
    comment: '簽署 payload SHA-256',
  })
  signingPayloadSha256!: string;

  @Column({
    name: 'consent_version',
    type: 'varchar',
    length: 50,
    comment: '同意文案版本',
  })
  consentVersion!: string;

  @Column({
    name: 'authentication_method',
    type: 'varchar',
    length: 50,
    comment: '身分驗證方式',
  })
  authenticationMethod!: string;

  @Column({
    name: 'authentication_event_id',
    type: 'varchar',
    length: 255,
    comment: '一次性驗證事件 ID',
  })
  authenticationEventId!: string;

  @Column({
    name: 'source_ip',
    type: 'varchar',
    length: 45,
    nullable: true,
    comment: '來源 IP',
  })
  sourceIp?: string;

  @Column({
    name: 'user_agent',
    type: 'varchar',
    length: 500,
    nullable: true,
    comment: 'User-Agent',
  })
  userAgent?: string;

  @Column({
    name: 'signed_at_utc',
    type: 'datetime',
    precision: 6,
    comment: '實際簽署時間',
  })
  signedAtUtc!: Date;

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
    precision: 6,
    comment: '建立時間',
  })
  createdAt!: Date;
}
