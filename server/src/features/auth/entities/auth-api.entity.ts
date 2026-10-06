import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { AuditableEntity } from '#app/infrastructure/database/auditable.entity';

/**
 * auth_apis — 受保護端點登錄表。
 * 由 @RegisterApi() / @Public() metadata 開機冪等同步；不由 API 新增 / 刪除。
 */
@Entity({ name: 'auth_apis', comment: '受保護端點登錄表' })
@Unique('uq_auth_apis_method_route', ['method', 'route'])
export class AuthApi extends AuditableEntity {
  @PrimaryGeneratedColumn({ name: 'id', type: 'bigint', comment: '流水號' })
  id!: number;

  @Index('uq_auth_apis_api_key', { unique: true })
  @Column({
    name: 'api_key',
    type: 'varchar',
    length: 150,
    comment: '由 @RegisterApi 宣告，例 roles.rename',
  })
  apiKey!: string;

  @Column({
    name: 'method',
    type: 'varchar',
    length: 10,
    comment: '僅 GET / POST',
  })
  method!: string;

  @Column({
    name: 'route',
    type: 'varchar',
    length: 200,
    comment: '路由樣板，例 /api/roles/:id',
  })
  route!: string;

  @Column({
    name: 'is_public',
    type: 'boolean',
    default: false,
    comment: '同步自 @Public()（稽核 metadata）',
  })
  isPublic!: boolean;

  @Column({
    name: 'is_active',
    type: 'boolean',
    default: true,
    comment: '啟用',
  })
  isActive!: boolean;
}
