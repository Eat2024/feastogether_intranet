import { AppErrors } from '#app/common/errors/app-errors';
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AppException } from '#app/common/errors/app.exception';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { User } from '#app/features/users/entities/user.entity';
import { FeastogetherHrService } from '#app/infrastructure/http-client/feastogether/services/feastogether-hr.service';
import type { StaffLookupDto } from '#app/infrastructure/http-client/feastogether/types/staff-lookup.dto';
import {
  isDuplicateEntryError,
  OauthIdentityRepository,
} from '#app/features/auth/repositories/oauth-identity.repository';

/** 已驗證的外部身分（sub 來自已驗證 ID token、其餘來自 UserInfo）；只接受驗證後資料。 */
export interface VerifiedOauthProfile {
  sub: string;
  userNumber: string | null;
  name: string | null;
}

/** 唯一鍵衝突時整筆交易最多重跑次數（含首次共兩次）。 */
const MAX_ATTEMPTS = 2;

/**
 * OAuth 身分 ↔ 本地帳號對應（一律以已驗證員編對照）：
 * 1. 以上游 UserInfo 的 employee_number 找 users.empid。
 * 2. 找不到 → 建立一般 User。
 * 全程在同一 MySQL 交易內並鎖定員工列；並發建立由 empid 唯一約束仲裁，衝突重跑一次。
 * 同步可信 HR 部門與受信任姓名、最後登入時間，不保存 oauth_sub。
 */
@Injectable()
export class OauthIdentityService {
  constructor(
    private readonly repo: OauthIdentityRepository,
    private readonly logger: AppLoggerService,
    private readonly mysql: MysqlService,
    private readonly hr: FeastogetherHrService,
  ) {}

  async resolve(profile: VerifiedOauthProfile): Promise<User> {
    const empId = profile.userNumber;
    if (!empId) {
      throw new AppException(...AppErrors.OAUTH_EMPLOYEE_ID_MISSING);
    }
    // 上游失敗直接拒絕；不開交易，也不以舊部門或客戶端 profile 授權。
    const staff = await this.hr.lookupEligibleStaff(empId);
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.mysql.transaction((manager) =>
          this.findOrCreate(empId, profile, staff, manager),
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
    staff: StaffLookupDto,
    manager: EntityManager,
  ): Promise<User> {
    const existing = await this.repo.findUserByEmpIdForUpdate(empId, manager);
    if (!existing) return this.createUser(empId, profile, staff, manager);
    if (existing.deletedAt || !existing.isActive) {
      throw new AppException(...AppErrors.ACCOUNT_DISABLED);
    }
    // 姓名缺值保留原值；可信部門缺值則寫入 NULL 清除舊授權。
    existing.name = profile.name ?? existing.name;
    existing.departmentCode = staff.department_id?.trim()
      ? staff.department_id
      : null;
    existing.departmentName = staff.department_name ?? null;
    existing.lastLoginAt = new Date();
    return this.repo.saveUser(existing, manager);
  }

  private async createUser(
    empId: string,
    profile: VerifiedOauthProfile,
    staff: StaffLookupDto,
    manager: EntityManager,
  ): Promise<User> {
    const user = await this.repo.createUser(
      {
        empid: empId,
        name: profile.name ?? empId,
        departmentCode: staff.department_id?.trim()
          ? staff.department_id
          : null,
        departmentName: staff.department_name ?? null,
        lastLoginAt: new Date(),
      },
      manager,
    );
    this.logger.info({
      context: OauthIdentityService.name,
      event: 'oauth.identity_created',
      message: '新員工首次 OAuth 登入建立員工帳號',
      metadata: { userId: user.id },
    });
    return user;
  }
}
