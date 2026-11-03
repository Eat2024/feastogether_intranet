import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AuditableEntity } from '#app/infrastructure/database/auditable.entity';

export type MailRecipientWhitelistType = 'department' | 'employee' | 'email';

@Entity({
  name: 'mail_recipient_whitelist',
  comment: '非正式環境寄信收件人白名單',
})
@Index('uq_mail_recipient_whitelist_type_value', ['type', 'value'], {
  unique: true,
})
export class MailRecipientWhitelist extends AuditableEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', comment: '白名單規則流水號' })
  id!: number;

  @Column({
    type: 'varchar',
    length: 20,
    collation: 'utf8mb4_0900_bin',
    comment: '規則類型：department 部門、employee 員工、email 收件信箱',
  })
  type!: MailRecipientWhitelistType;

  @Column({
    type: 'varchar',
    length: 255,
    collation: 'utf8mb4_0900_bin',
    comment: '完整部門代碼、員編或小寫收件信箱',
  })
  value!: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '維護備註' })
  remark!: string | null;
}
