import { Inject, Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AuditLogTarget } from '#app/features/auth/entities/audit-log-target.entity';
import { AuditLog } from '#app/features/auth/entities/audit-log.entity';
import { AuthApiPermission } from '#app/features/auth/entities/auth-api-permission.entity';
import { AuthApi } from '#app/features/auth/entities/auth-api.entity';
import { AuthGroup } from '#app/features/auth/entities/auth-group.entity';
import { AuthGroupJob } from '#app/features/auth/entities/auth-group-job.entity';
import { AuthJobPermission } from '#app/features/auth/entities/auth-job-permission.entity';
import { AuthRolePermission } from '#app/features/auth/entities/auth-role-permission.entity';
import { AuthRole } from '#app/features/auth/entities/auth-role.entity';
import { AuthUser } from '#app/features/auth/entities/auth-user.entity';

/**
 * 集中注入 MySQL raw repositories。
 *
 * 這層只負責持有 TypeORM Repository，不放 domain 查詢方法；
 * 各 feature/domain 請在自己的 repositories 目錄封裝查詢語意。
 */
@Injectable()
export class MysqlEntityService {
  constructor(
    @Inject('AuditLogTypeOrmRepository')
    readonly auditLog: Repository<AuditLog>,
    @Inject('AuditLogTargetRepository')
    readonly auditLogTarget: Repository<AuditLogTarget>,
    @Inject('AuthApiRepository')
    readonly authApi: Repository<AuthApi>,
    @Inject('AuthApiPermissionRepository')
    readonly authApiPermission: Repository<AuthApiPermission>,
    @Inject('AuthGroupRepository')
    readonly authGroup: Repository<AuthGroup>,
    @Inject('AuthGroupJobRepository')
    readonly authGroupJob: Repository<AuthGroupJob>,
    @Inject('AuthJobPermissionRepository')
    readonly authJobPermission: Repository<AuthJobPermission>,
    @Inject('AuthRoleRepository')
    readonly authRole: Repository<AuthRole>,
    @Inject('AuthRolePermissionRepository')
    readonly authRolePermission: Repository<AuthRolePermission>,
    @Inject('AuthUserRepository')
    readonly authUser: Repository<AuthUser>,
  ) {}
}
