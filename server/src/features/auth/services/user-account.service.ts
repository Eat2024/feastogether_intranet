import {
  FeastogetherHrService,
  staffLookupError,
} from '#app/infrastructure/http-client/feastogether/services/feastogether-hr.service';
import { StaffLookupDto } from '#app/infrastructure/http-client/feastogether/types/staff-lookup.dto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { EntityManager, QueryFailedError } from 'typeorm';
import { AppException } from '#app/common/errors/app.exception';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY,
  isAdminRole,
} from '#app/features/auth/auth.constants';
import { AuthRole } from '#app/features/auth/entities/auth-role.entity';
import { AuthUser } from '#app/features/auth/entities/auth-user.entity';
import { BatchUpdateStatusDto } from '#app/features/auth/dto/batch-update-status.dto';
import { ListUsersDto } from '#app/features/auth/dto/list-users.dto';
import { SearchEmployeeOptionsDto } from '#app/features/auth/dto/search-employee-options.dto';
import { UpdateUserDto } from '#app/features/auth/dto/update-user.dto';
import {
  EmployeeOption,
  UserDetail,
  UserListItem,
  UserRoleRef,
  toUserDetail,
  toUserListItem,
} from '#app/features/auth/mappers/user.mapper';
import { RoleRepository } from '#app/features/auth/repositories/role.repository';
import { UserAccountRepository } from '#app/features/auth/repositories/user-account.repository';
import { AuditLogService } from './audit-log.service';
import { ApiAuthorizationService } from './api-authorization.service';
import { AuthSessionVerifierService } from './auth-session-verifier.service';

/**
 * 分頁清單回應——分頁欄位一律**攤平在第一層**，不包 `meta`
 * （全站統一的分頁回應形狀）。
 */
export interface PagedUsers {
  users: UserListItem[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * 使用者帳號管理（Story 2）：查詢 / 角色指派 / 啟用停用 / 備註。
 * 未建檔者僅由 fgapi 匯入；部門/職稱為外部同步顯示欄，不接受手動編輯。
 */
@Injectable()
export class UserAccountService {
  constructor(
    private readonly users: UserAccountRepository,
    private readonly roles: RoleRepository,
    private readonly auditLog: AuditLogService,
    private readonly authorization: ApiAuthorizationService,
    private readonly sessions: AuthSessionVerifierService,
    private readonly hr: FeastogetherHrService,
  ) {}

  /** 分頁 + 關鍵字模糊（姓名/工號/部門/角色名稱）+ 角色 tab（roleId），排除軟刪。 */
  async list(dto: ListUsersDto): Promise<PagedUsers> {
    const { keyword, roleId, page, pageSize } = dto;
    const { rows, total } = await this.users.listWithTotal(
      { keyword, roleId },
      (page - 1) * pageSize,
      pageSize,
    );
    return {
      users: rows.map(toUserListItem),
      page,
      pageSize,
      total,
    };
  }

  /** 單一使用者詳情（含角色名稱與 isSystemAdmin）。 */
  async getDetail(id: number): Promise<UserDetail> {
    const user = await this.loadUser(undefined, id);
    const info = await this.roleInfoOf(user.roleId);
    return toUserDetail(user, info.ref, info.isSystemAdmin);
  }

  /**
   * 依 empId 批次更新啟用狀態（atomic）。停用時經 assertNotDisablingAdmin 擋超管。
   * - empIds 去重；任一查無 → USER_NOT_FOUND 404（整批 rollback）。
   * - 停用超管 → ADMIN_ROLE_LOCKED 403（整批 rollback）。
   * - 僅對 isActive 有變動者套用並寫稽核；無變動者跳過。
   * - commit 後回傳最新列資料 `users`（形狀同 GET /api/users 的 users[]）供前端一次性重繪：
   *   帶 roleId → 回該角色全部使用者（整個 tab）；未帶 → 回這批 empIds。
   *   roleId 只決定回傳範圍，不影響「更新哪些人」（更新一律由 empIds 驅動）。
   */
  async batchUpdateStatus(
    dto: BatchUpdateStatusDto,
  ): Promise<{ users: UserListItem[] }> {
    const empIds = [...new Set(dto.empIds)];
    const changedUserIds = await this.users.transaction(async (manager) => {
      const users = await this.users.findByEmpIds(empIds, manager);
      if (users.length !== empIds.length) {
        const found = new Set(users.map((u) => u.personEmpid));
        const missing = empIds.filter((e) => !found.has(e));
        throw new AppException(
          AppErrorCode.USER_NOT_FOUND,
          `使用者不存在：${missing.join(', ')}`,
          HttpStatus.NOT_FOUND,
        );
      }
      // 停用才需判定超管：一次預載這批 distinct 角色成 Map，避免每筆重查（N+1）。
      // 啟用不檢查超管，故免預載。
      const adminByRole = dto.isActive
        ? new Map<number, boolean>()
        : await this.loadAdminByRole(users, manager);
      const changedUserIds: number[] = [];
      for (const user of users) {
        if (user.isActive === dto.isActive) continue; // 無變動不動、不寫稽核
        const isSystemAdmin = user.roleId
          ? (adminByRole.get(user.roleId) ?? false)
          : false;
        await this.applyStatus(manager, user, dto.isActive, isSystemAdmin);
        await this.users.save(user, manager);
        changedUserIds.push(Number(user.id));
      }
      return changedUserIds;
    });
    await Promise.all(
      changedUserIds.map((userId) => this.authorization.refreshUser(userId)),
    );
    // 034 SEC-06：停用（isActive=false）後撤該批帳號的既有 session，令 token 立即失效。
    if (dto.isActive === false) {
      await Promise.all(
        changedUserIds.map((userId) => this.sessions.revokeAllSessions(userId)),
      );
    }
    // commit 後重查最新列資料（含角色 join / isSystemAdmin），一次帶回前端。
    // 帶 roleId → 整個角色；未帶 → 這批 empIds。
    const rows =
      dto.roleId !== undefined
        ? await this.users.listItemsByRoleId(dto.roleId)
        : await this.users.listItemsByEmpIds(empIds);
    return { users: rows.map(toUserListItem) };
  }

  /**
   * 部分更新角色 / 啟用狀態 / 備註（交易內逐項套用）。
   * - roleId：覆蓋指派（須存在且啟用，否則 INVALID_ROLE_ID）→ 寫 user_role_updated。
   *   （目前無「取消指派」業務需求，故不支援 roleId=null。）
   * - isActive：寫 user_status_updated，commit 後同步既有授權快取。
   * - description：刻意不寫稽核（非權責欄位，變更不需追溯）。若日後需追溯再比照上面補 recordHistory。
   */
  async updateRoleAndStatus(
    empId: string,
    dto: UpdateUserDto,
  ): Promise<UserDetail> {
    const existing = await this.users.findByEmpId(empId, undefined, true);
    if (existing?.deletedAt) throw staffLookupError();
    // 外部查詢在交易外執行；只有明確指派角色時才允許匯入。
    if (!existing && !Number.isInteger(dto.roleId)) this.assertFound(existing);
    const profile = existing ? null : (await this.hr.lookupStaff(empId))[0];
    const result = await this.saveRoleAndStatus(empId, dto, profile);
    if (result.authorizationChanged) {
      await this.authorization.refreshUser(result.detail.id);
    }
    // 主管停用該帳號，登出所有session
    if (dto.isActive === false) {
      await this.sessions.revokeAllSessions(result.detail.id);
    }
    return result.detail;
  }

  /** 同員編並發建帳由唯一鍵仲裁；整筆交易最多重試一次。 */
  private async saveRoleAndStatus(
    empId: string,
    dto: UpdateUserDto,
    profile: StaffLookupDto | null,
  ) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.updateInTransaction(empId, dto, profile);
      } catch (error) {
        if (
          attempt > 0 ||
          !(error instanceof QueryFailedError) ||
          !['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK'].includes(
            (error.driverError as { code?: string }).code ?? '',
          )
        )
          throw error;
      }
    }
  }

  private updateInTransaction(
    empId: string,
    dto: UpdateUserDto,
    profile: StaffLookupDto | null,
  ) {
    return this.users.transaction(async (manager) => {
      const user = await this.loadOrImportUser(manager, empId, profile);
      const originalRoleId = user.roleId;
      const originalStatus = user.isActive;

      // 角色查詢一律走交易 manager：未動角色時讀現值組回應，避免 commit 後再查（read-after-write 空窗）。
      // applyRole 保證指派的角色非系統管理員（擋提權），故該分支 isSystemAdmin 必為 false。
      let role: UserRoleRef | null;
      let isSystemAdmin: boolean;
      if (dto.roleId !== undefined) {
        role = await this.applyRole(manager, user, dto.roleId);
        isSystemAdmin = false;
      } else {
        const info = await this.roleInfoOf(user.roleId, manager);
        role = info.ref;
        isSystemAdmin = info.isSystemAdmin;
      }

      if (dto.isActive !== undefined && dto.isActive !== user.isActive) {
        // isSystemAdmin 已於上方算出，直接傳入，applyStatus 免再查角色。
        await this.applyStatus(manager, user, dto.isActive, isSystemAdmin);
      }
      // description 刻意不寫稽核（見方法註解）：非權責欄位，僅更新值。
      if (dto.description !== undefined) {
        user.description = dto.description;
      }
      await this.users.save(user, manager);
      // 用交易內已載入的資料組回應，不再 re-read
      return {
        detail: toUserDetail(user, role, isSystemAdmin),
        authorizationChanged:
          originalRoleId !== user.roleId || originalStatus !== user.isActive,
      };
    });
  }

  /** 5～8 碼員編片段查 fgapi；只回傳選項，不在查詢時建檔。 */
  async searchEmployeeOptions(
    dto: SearchEmployeeOptionsDto,
  ): Promise<EmployeeOption[]> {
    const profiles = await this.hr.lookupStaff(dto.empId);
    if (!profiles.length) return [];
    const existing = await this.users.findByEmpIdsIncludingDeleted(
      profiles.map((profile) => profile.person_empid),
    );
    const localByEmpId = new Map(
      existing.map((user) => [user.personEmpid, user]),
    );
    return profiles
      .filter((profile) => !localByEmpId.get(profile.person_empid)?.deletedAt)
      .map((profile) => ({
        empId: profile.person_empid,
        name: profile.person_name?.trim() || profile.person_empid,
        departmentName: profile.department_name ?? null,
        isActive: localByEmpId.get(profile.person_empid)?.isActive ?? true,
      }));
  }

  // ─────────────────────────── 私有共用 ───────────────────────────

  /**
   * 覆蓋指派角色：須指向存在且啟用的角色，否則 INVALID_ROLE_ID。
   * 回傳套用後的角色顯示物件，供呼叫端直接組回應。
   */
  private async applyRole(
    manager: EntityManager,
    user: AuthUser,
    roleId: number,
  ): Promise<UserRoleRef> {
    const before = user.roleId ?? null;
    const role = await this.assertActiveRole(roleId, manager);
    // 帳號管理不得指派系統管理員（超級使用者）角色，避免藉指派角色提權（授權服務對 is_admin 全放行）。
    if (isAdminRole(role)) {
      throw new AppException(
        AppErrorCode.ADMIN_ROLE_LOCKED,
        '系統管理員角色不可透過帳號管理指派',
        HttpStatus.FORBIDDEN,
      );
    }
    const after = Number(role.id);
    if (before !== after) {
      user.roleId = after;
      await this.recordRoleChange(manager, user, before, after);
    }
    return { id: after, roleName: role.roleName };
  }

  /** 角色異動稽核（覆蓋指派使用）。 */
  private async recordRoleChange(
    manager: EntityManager,
    user: AuthUser,
    before: number | null,
    after: number,
  ): Promise<void> {
    await this.auditLog.recordHistory(
      {
        action: AUDIT_ACTION.USER_ROLE_UPDATED,
        entityType: AUDIT_ENTITY.USER,
        entityId: user.id,
        beforeSnapshot: { roleId: before },
        afterSnapshot: { roleId: after },
        associatedTargets: [
          { type: AUDIT_ENTITY.ROLE, id: before },
          { type: AUDIT_ENTITY.ROLE, id: after },
        ],
      },
      manager,
    );
  }

  private async applyStatus(
    manager: EntityManager,
    user: AuthUser,
    isActive: boolean,
    isSystemAdmin: boolean,
  ): Promise<void> {
    this.assertNotDisablingAdmin(user.isActive, isActive, isSystemAdmin);
    const before = user.isActive;
    user.isActive = isActive;
    await this.auditLog.recordHistory(
      {
        action: AUDIT_ACTION.USER_STATUS_UPDATED,
        entityType: AUDIT_ENTITY.USER,
        entityId: user.id,
        beforeSnapshot: { isActive: before },
        afterSnapshot: { isActive },
      },
      manager,
    );
  }

  /** 載入並驗證角色（存在且啟用），走交易 manager 避免 check-then-write 競態。 */
  private async assertActiveRole(
    roleId: number,
    manager: EntityManager,
  ): Promise<AuthRole> {
    const role = await this.roles.findById(roleId, manager);
    if (!role || !role.isActive) {
      throw new AppException(
        AppErrorCode.INVALID_ROLE_ID,
        '角色不存在或已停用',
        HttpStatus.BAD_REQUEST,
      );
    }
    return role;
  }

  private async loadUser(
    manager: EntityManager | undefined,
    id: number,
  ): Promise<AuthUser> {
    return this.assertFound(await this.users.findById(id, manager));
  }

  /** 交易內重讀並鎖定，避免與登入／其他主管建檔相互覆蓋。 */
  private async loadOrImportUser(
    manager: EntityManager,
    empId: string,
    profile: StaffLookupDto | null,
  ): Promise<AuthUser> {
    const existing = await this.users.findByEmpId(empId, manager, true);
    if (existing?.deletedAt) throw staffLookupError();
    if (existing) return existing;
    if (!profile) throw staffLookupError();
    return this.users.create(
      {
        personEmpid: profile.person_empid,
        personName: profile.person_name?.trim() || profile.person_empid,
        personStatus: profile.person_status_name,
        departmentCode: profile.department_id ?? undefined,
        departmentName: profile.department_name ?? undefined,
        titleName: profile.title ?? undefined,
        isActive: true,
      },
      manager,
    );
  }

  private assertFound(user: AuthUser | null): AuthUser {
    if (!user) {
      throw new AppException(
        AppErrorCode.USER_NOT_FOUND,
        '使用者不存在',
        HttpStatus.NOT_FOUND,
      );
    }
    return user;
  }

  /**
   * 載入角色顯示物件 + 是否系統管理員（委派 auth.constants 的 isAdminRole 判定）。無角色 → { null, false }。
   * 供 getDetail 與 updateRoleAndStatus 重用，避免各自再算一次。
   */
  private async roleInfoOf(
    roleId?: number,
    manager?: EntityManager,
  ): Promise<{ ref: UserRoleRef | null; isSystemAdmin: boolean }> {
    if (!roleId) return { ref: null, isSystemAdmin: false };
    const role = await this.roles.findById(roleId, manager);
    if (!role) return { ref: null, isSystemAdmin: false };
    return {
      ref: { id: Number(role.id), roleName: role.roleName },
      isSystemAdmin: isAdminRole(role),
    };
  }

  /**
   * 停用擋超管（單筆與批次共用，純判定不查 DB）：僅當「由啟用轉停用」且該使用者為系統管理員時，
   * 拋 ADMIN_ROLE_LOCKED（403）。啟用、或狀態未由啟用轉停用者不檢查。
   * isSystemAdmin 由呼叫端預先算好（單筆用 roleInfoOf、批次用 loadAdminByRole 預載），
   * 避免每筆停用重查角色（消 N+1）。
   */
  private assertNotDisablingAdmin(
    wasActive: boolean,
    nextIsActive: boolean,
    isSystemAdmin: boolean,
  ): void {
    if (nextIsActive || !wasActive) return; // 非「啟用→停用」轉換
    if (isSystemAdmin) {
      throw new AppException(
        AppErrorCode.ADMIN_ROLE_LOCKED,
        '系統管理員帳號不可停用',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private async loadAdminByRole(
    users: AuthUser[],
    manager: EntityManager,
  ): Promise<Map<number, boolean>> {
    const roleIds = [
      ...new Set(
        users.map((u) => u.roleId).filter((id): id is number => id != null),
      ),
    ];
    if (!roleIds.length) return new Map();
    const roles = await this.roles.findByIds(roleIds, manager);
    return new Map(roles.map((r) => [Number(r.id), isAdminRole(r)]));
  }
}
