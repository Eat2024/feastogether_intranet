import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '#app/common/errors/app.exception';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import {
  ADMIN_ROLE_CODE,
  DEV_LOGIN_EMPID,
  DEV_LOGIN_NAME,
  SESSION_SOURCE,
} from '#app/features/auth/auth.constants';
import { AuthUser } from '#app/features/auth/entities/auth-user.entity';
import { isDuplicateEntryError } from '#app/features/auth/repositories/oauth-identity.repository';
import { assertDevModeSafe, isDevLoginAllowed } from '#app/framework/auth-mode';
import { MysqlEntityService } from '#app/infrastructure/database/mysql/mysql.entity.service';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import { ApiAuthorizationService } from './api-authorization.service';
import { AuthSessionService } from './auth-session.service';
import { AuthService, type AuthSession } from './auth.service';

export interface DevLoginResult {
  accessToken: string;
  session: AuthSession;
}

/**
 * 開發者登入（DEVMOD）：本機沒有統一登入可串接時，直接以固定的開發者帳號
 * （DEV_LOGIN_EMPID，綁 ADMIN 角色）簽發 session。之後 AuthGuard、RBAC、/me、
 * 稽核皆與正式登入走同一條路徑，差別只在身分不經上游驗證。
 * 僅 DEVMOD=true 且非 production / staging 時開放；已部署環境誤設即開機失敗。
 */
@Injectable()
export class DevLoginService {
  constructor(
    private readonly config: ConfigService,
    private readonly db: MysqlEntityService,
    private readonly sessions: AuthSessionService,
    private readonly authorization: ApiAuthorizationService,
    private readonly authService: AuthService,
    private readonly logger: AppLoggerService,
  ) {
    assertDevModeSafe(config);
  }

  async login(): Promise<DevLoginResult> {
    // 未開放時回 404：不讓外界知道有這個端點。
    if (!isDevLoginAllowed(this.config)) {
      throw new AppException(
        AppErrorCode.NOT_FOUND,
        '找不到資源',
        HttpStatus.NOT_FOUND,
      );
    }

    const user = await this.ensureDevUser();
    const accessToken = await this.sessions.issue(Number(user.id), {
      source: SESSION_SOURCE.DEV,
      encryptedRefreshToken: null,
    });
    await this.authorization.rememberUser(Number(user.id));
    this.logger.warn({
      context: DevLoginService.name,
      event: 'auth.dev_login',
      message: '開發者登入（DEVMOD）已簽發超級管理員 session',
      metadata: { userId: user.id },
    });
    return { accessToken, session: await this.authService.buildSession(user) };
  }

  /**
   * 建立或沿用開發者帳號，並確保其為啟用中的 ADMIN（被停用、軟刪或改過角色都會還原）。
   * 並發首次建帳由 person_empid 唯一約束仲裁，衝突時重讀一次。
   */
  private async ensureDevUser(): Promise<AuthUser> {
    const adminRole = await this.db.authRole.findOne({
      where: { roleCode: ADMIN_ROLE_CODE },
    });
    if (!adminRole) {
      throw new AppException(
        AppErrorCode.INTERNAL_ERROR,
        '尚未建立 ADMIN 角色，請先執行 pnpm -C server seed:rbac',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    try {
      return await this.saveDevUser(Number(adminRole.id));
    } catch (error) {
      if (!isDuplicateEntryError(error)) throw error;
      return this.saveDevUser(Number(adminRole.id));
    }
  }

  private async saveDevUser(adminRoleId: number): Promise<AuthUser> {
    const existing = await this.db.authUser.findOne({
      where: { personEmpid: DEV_LOGIN_EMPID },
      withDeleted: true,
    });
    if (existing?.deletedAt) {
      await this.db.authUser.restore({ id: existing.id });
    }
    const user =
      existing ??
      this.db.authUser.create({
        personEmpid: DEV_LOGIN_EMPID,
        personName: DEV_LOGIN_NAME,
      });
    user.roleId = adminRoleId;
    user.isActive = true;
    user.deletedAt = undefined;
    user.lastLoginAt = new Date();
    return this.db.authUser.save(user);
  }
}
