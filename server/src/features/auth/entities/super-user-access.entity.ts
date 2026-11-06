import { Check, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { AuditableEntity } from '#app/infrastructure/database/auditable.entity';

/**
 * Super user 維護入口與帳密啟用版本，全表只有 id=1 一列。
 * 每次驗證維護登入／會話都重新讀取，不快取；soft-deleted 視同不存在。
 */
@Entity({
  name: 'super_user_access',
  comment: 'Super user 維護入口與帳密啟用版本（單列）',
})
@Check('chk_super_user_access_singleton', '`id` = 1')
@Check('chk_super_user_access_entry_generation', '`entry_generation` >= 1')
@Check(
  'chk_super_user_access_credential_generation',
  '`credential_generation` >= 1',
)
@Index('idx_super_user_access_rotated_at', ['rotatedAt'])
@Index('idx_super_user_access_period_start_at', ['periodStartAt'])
@Index('idx_super_user_access_credential_activated_at', [
  'credentialActivatedAt',
])
@Index('idx_super_user_access_created_at', ['createdAt'])
@Index('idx_super_user_access_updated_at', ['updatedAt'])
@Index('idx_super_user_access_deleted_at', ['deletedAt'])
export class SuperUserAccess extends AuditableEntity {
  @PrimaryColumn({
    name: 'id',
    type: 'tinyint',
    unsigned: true,
    comment: '固定單列識別（恆為 1，不是員工 ID）',
  })
  id!: number;

  @Column({
    name: 'entry_key',
    type: 'char',
    length: 43,
    charset: 'ascii',
    collation: 'ascii_bin',
    comment: '目前隱藏入口識別（base64url）',
  })
  entryKey!: string;

  @Column({
    name: 'entry_generation',
    type: 'bigint',
    unsigned: true,
    comment: '入口輪換版本',
  })
  entryGeneration!: number;

  @Column({
    name: 'rotated_at',
    type: 'datetime',
    precision: 6,
    comment: '目前入口生效時間',
  })
  rotatedAt!: Date;

  @Column({
    name: 'period_start_at',
    type: 'datetime',
    precision: 6,
    comment: '最近已處理的輪換週期起點',
  })
  periodStartAt!: Date;

  @Column({
    name: 'active_credential_fingerprint',
    type: 'char',
    length: 64,
    charset: 'ascii',
    collation: 'ascii_bin',
    comment: '目前啟用的帳密設定指紋',
  })
  activeCredentialFingerprint!: string;

  @Column({
    name: 'credential_generation',
    type: 'bigint',
    unsigned: true,
    comment: '帳密啟用版本',
  })
  credentialGeneration!: number;

  @Column({
    name: 'credential_activated_at',
    type: 'datetime',
    precision: 6,
    comment: '帳密啟用時間',
  })
  credentialActivatedAt!: Date;
}
