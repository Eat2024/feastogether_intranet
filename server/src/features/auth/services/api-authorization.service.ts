import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { RoleUserRepository } from '../repositories/role-user.repository';
import {
  AuthorizationCacheService,
  AuthorizationSnapshot,
} from './authorization-cache.service';

interface AuthorizationRow {
  user_id: number | string;
  role_id: number | string | null;
  user_active: boolean | number | string;
  role_active: boolean | number | string | null;
  is_admin: boolean | number | string | null;
  permission_key: string | null;
}

@Injectable()
export class ApiAuthorizationService {
  constructor(
    @Inject(MYSQL_MAIN) private readonly dataSource: DataSource,
    private readonly cache: AuthorizationCacheService,
    private readonly roleUsers: RoleUserRepository,
  ) {}

  async isActiveUser(userId: number): Promise<boolean> {
    const snapshot = await this.getSnapshot(userId);
    return snapshot !== null && isActive(snapshot);
  }

  async hasPermission(userId: number, permissionKey: string): Promise<boolean> {
    const snapshot = await this.getSnapshot(userId);
    return snapshot !== null && hasPermission(snapshot, permissionKey);
  }

  async hasAnyPermission(
    userId: number,
    permissionKeys: readonly string[],
  ): Promise<boolean> {
    const snapshot = await this.getSnapshot(userId);
    return (
      snapshot !== null &&
      permissionKeys.some((permissionKey) =>
        hasPermission(snapshot, permissionKey),
      )
    );
  }

  async rememberUser(userId: number): Promise<void> {
    const snapshot = await this.loadSnapshot(userId);
    if (snapshot !== null) await this.cache.create(snapshot);
  }

  async refreshUser(userId: number): Promise<void> {
    const cached = await this.cache.get(userId);
    if (cached === null) return;

    const snapshot = await this.loadSnapshot(userId);
    if (snapshot !== null) await this.cache.update(snapshot);
  }

  async refreshRoleUsers(roleId: number): Promise<void> {
    const users = await this.roleUsers.findByRoleId(roleId);
    await Promise.all(users.map((user) => this.refreshUser(Number(user.id))));
  }

  private async getSnapshot(
    userId: number,
  ): Promise<AuthorizationSnapshot | null> {
    const cached = await this.cache.get(userId);
    if (cached !== null) return cached;
    const snapshot = await this.loadSnapshot(userId);
    if (snapshot !== null) await this.cache.create(snapshot);
    return snapshot;
  }

  private async loadSnapshot(
    userId: number,
  ): Promise<AuthorizationSnapshot | null> {
    const rows: AuthorizationRow[] = await this.dataSource.query(
      `SELECT u.id AS user_id,
              u.role_id AS role_id,
              u.is_active AS user_active,
              COALESCE(r.is_active, 0) AS role_active,
              COALESCE(r.is_admin, 0) AS is_admin,
              CASE WHEN gj.id IS NOT NULL AND g.id IS NOT NULL
                   THEN jp.permission_key ELSE NULL END AS permission_key
         FROM auth_users u
         LEFT JOIN auth_roles r
           ON r.id = u.role_id AND r.deleted_at IS NULL
         LEFT JOIN auth_role_permissions rp
           ON rp.role_id = r.id AND rp.deleted_at IS NULL
         LEFT JOIN auth_job_permission jp
           ON jp.id = rp.permission_id AND jp.deleted_at IS NULL
         LEFT JOIN auth_group_jobs gj
           ON gj.id = jp.job_id AND gj.is_active = 1 AND gj.deleted_at IS NULL
         LEFT JOIN auth_group g
           ON g.id = gj.group_id AND g.is_active = 1 AND g.deleted_at IS NULL
        WHERE u.id = ? AND u.deleted_at IS NULL`,
      [userId],
    );
    if (rows.length === 0) return null;

    const first = rows[0];
    return {
      userId: Number(first.user_id),
      roleId: first.role_id === null ? null : Number(first.role_id),
      userActive: isTrue(first.user_active),
      roleActive: isTrue(first.role_active),
      isAdmin: isTrue(first.is_admin),
      permissions: [
        ...new Set(
          rows
            .map((row) => row.permission_key)
            .filter((key): key is string => typeof key === 'string'),
        ),
      ],
    };
  }
}

function isActive(snapshot: AuthorizationSnapshot): boolean {
  return snapshot.userActive && snapshot.roleActive;
}

function hasPermission(
  snapshot: AuthorizationSnapshot,
  permissionKey: string,
): boolean {
  return (
    isActive(snapshot) &&
    (snapshot.isAdmin || snapshot.permissions.includes(permissionKey))
  );
}

function isTrue(value: boolean | number | string | null): boolean {
  return value === true || value === 1 || value === '1';
}
