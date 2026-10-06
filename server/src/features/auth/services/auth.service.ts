import { HttpStatus, Injectable } from '@nestjs/common';
import { MysqlEntityService } from '#app/infrastructure/database/mysql/mysql.entity.service';
import { AppException } from '#app/common/errors/app.exception';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AuthUser } from '#app/features/auth/entities/auth-user.entity';
import {
  AuthNavigation,
  buildAuthNavigation,
} from '#app/features/auth/mappers/auth-navigation.mapper';
import { PermissionRepository } from '#app/features/auth/repositories/permission.repository';
import { AuthSessionService } from './auth-session.service';

export interface SessionUser {
  id: number;
  empId: string;
  name: string;
  departmentCode: string | null;
  departmentName: string | null;
  titleName: string | null;
  lastLoginAt: Date | null;
}

export interface SessionRole {
  id: number;
  roleName: string;
  roleCode: string;
  isAdmin: boolean;
}

/** 登入（OAuth 回呼）/ me 共用回應（對齊 docs/rbac-api-frontend.md）。 */
export interface AuthSession extends AuthNavigation {
  user: SessionUser;
  role: SessionRole | null;
}

/**
 * 登入者資料與導覽組裝。登入一律走統一登入（OauthLoginService），
 * 本類別提供 /me 與登入回應共用的 buildSession。
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly sessions: AuthSessionService,
    private readonly db: MysqlEntityService,
    private readonly permissions: PermissionRepository,
  ) {}

  /** 取目前登入者完整導覽（GET /api/auth/me；不含 accessToken）。 */
  async getMe(
    userId: number,
    cookieToken: string | null,
  ): Promise<AuthSession> {
    this.assertAuthenticated(userId);
    const [user, record] = await Promise.all([
      this.db.authUser.findOne({ where: { id: userId } }),
      cookieToken ? this.sessions.read(userId, cookieToken) : null,
    ]);
    if (!user || !user.isActive || !record) {
      throw new AppException(
        AppErrorCode.INVALID_CREDENTIALS,
        '使用者不存在或已停用',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return this.buildSession(user);
  }

  /**
   * 組登入 / me 共用回應：user + role + 完整導覽（groups/jobPermissions）。
   * 無角色（首次登入）→ role=null、所有 enabled/checked 皆 false。
   */
  async buildSession(user: AuthUser): Promise<AuthSession> {
    const [role, navigation] = await Promise.all([
      user.roleId
        ? this.db.authRole.findOne({ where: { id: user.roleId } })
        : Promise.resolve(null),
      this.buildNavigation(user.roleId),
    ]);
    return {
      user: {
        id: Number(user.id),
        empId: user.personEmpid,
        name: user.personName,
        departmentCode: user.departmentCode ?? null,
        departmentName: user.departmentName ?? null,
        titleName: user.titleName ?? null,
        lastLoginAt: user.lastLoginAt ?? null,
      },
      role: role
        ? {
            id: Number(role.id),
            roleName: role.roleName,
            roleCode: role.roleCode,
            isAdmin: role.isAdmin,
          }
        : null,
      ...navigation,
    };
  }

  /** 三層權限資料 → 扁平導覽；無角色回全 false 導覽。 */
  private async buildNavigation(roleId?: number): Promise<AuthNavigation> {
    const [groups, jobs, permissions, checkedIds] = await Promise.all([
      this.permissions.listActiveGroups(),
      this.permissions.listActiveJobs(),
      this.permissions.listPermissions(),
      roleId
        ? this.permissions.currentPermissionIdSet(roleId)
        : Promise.resolve(new Set<number>()),
    ]);
    return buildAuthNavigation(groups, jobs, permissions, checkedIds);
  }

  /** 需有效身分（req.user 已掛載）；無則回 401，避免 NaN 進 DB / Redis。 */
  private assertAuthenticated(userId: number): void {
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new AppException(
        AppErrorCode.UNAUTHORIZED,
        '未通過身分驗證',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }
}
