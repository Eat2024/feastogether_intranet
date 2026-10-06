import { HttpStatus, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AppException } from '#app/common/errors/app.exception';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import { AuthUser } from '#app/features/auth/entities/auth-user.entity';
import {
  isDuplicateEntryError,
  OauthIdentityRepository,
} from '#app/features/auth/repositories/oauth-identity.repository';

/** 已驗證的外部身分（sub 來自已驗證 ID token、其餘來自 UserInfo）；只接受驗證後資料。 */
export interface VerifiedOauthProfile {
  sub: string;
  employeeNumber: string | null;
  name: string | null;
}

/** 唯一鍵衝突時整筆交易最多重跑次數（含首次共兩次）。 */
const MAX_ATTEMPTS = 2;

/**
 * OAuth 身分 ↔ 本地帳號對應（一律以已驗證員編對照）：
 * 1. 以 UserInfo 的 employee_number 找 auth_users.person_empid；找到即為該使用者
 *    （含 seed:rbac 以 SUPER_ADMIN_EMPID 預建、已綁 ADMIN 的初始管理員）。
 * 2. 找不到 → 建立無角色帳號。
 * 全程在同一 MySQL 交易內並鎖定使用者列；並發建帳由 person_empid 唯一約束仲裁，衝突重跑一次。
 * 不覆寫 role／isActive／description／部門職稱；只更新姓名、最後登入時間與 oauth_sub（記最近一次 sub，非識別鍵）。
 */
@Injectable()
export class OauthIdentityService {
  constructor(
    private readonly repo: OauthIdentityRepository,
    private readonly logger: AppLoggerService,
  ) {}

  async resolve(profile: VerifiedOauthProfile): Promise<AuthUser> {
    const empId = profile.employeeNumber;
    if (!empId) {
      throw new AppException(
        AppErrorCode.OAUTH_RESPONSE_INVALID,
        '統一登入未提供員工編號，無法對應帳號',
        HttpStatus.UNAUTHORIZED,
      );
    }
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.repo.transaction((manager) =>
          this.findOrCreate(empId, profile, manager),
        );
      } catch (error) {
        if (attempt >= MAX_ATTEMPTS || !isDuplicateEntryError(error)) {
          throw error;
        }
        // 兩個入口同時建帳：讓唯一鍵仲裁後重讀一次，第二次仍衝突就拒絕。
      }
    }
  }

  private async findOrCreate(
    empId: string,
    profile: VerifiedOauthProfile,
    manager: EntityManager,
  ): Promise<AuthUser> {
    const existing = await this.repo.findUserByEmpIdForUpdate(empId, manager);
    if (!existing) return this.createUser(empId, profile, manager);
    if (existing.deletedAt || !existing.isActive) {
      throw new AppException(
        AppErrorCode.ACCOUNT_DISABLED,
        '帳號已停用',
        HttpStatus.FORBIDDEN,
      );
    }
    // 只更新姓名、最後登入時間與最近一次 sub；姓名缺值不清空既有資料（FR-007）。
    existing.personName = profile.name ?? existing.personName;
    existing.lastLoginAt = new Date();
    existing.oauthSub = profile.sub;
    return this.repo.saveUser(existing, manager);
  }

  private async createUser(
    empId: string,
    profile: VerifiedOauthProfile,
    manager: EntityManager,
  ): Promise<AuthUser> {
    const user = await this.repo.createUser(
      {
        personEmpid: empId,
        personName: profile.name ?? empId,
        lastLoginAt: new Date(),
        oauthSub: profile.sub,
      },
      manager,
    );
    this.logger.info({
      context: OauthIdentityService.name,
      event: 'oauth.identity_created',
      message: '新員工首次 OAuth 登入建立無角色帳號',
      metadata: { userId: user.id },
    });
    return user;
  }
}
