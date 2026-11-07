import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { EligibleStaffService } from '#app/features/auth/services/eligible-staff.service';
import type { StaffLookupDto } from '#app/features/auth/dto/staff-lookup.dto';
import { isDuplicateEntryError } from '#app/features/auth/repositories/oauth-identity.repository';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import type { User } from '#app/features/users/entities/user.entity';
import { AuthorizationRepository } from '../repositories/authorization.repository';
import {
  AssignmentDto,
  type EmployeeRolesDto,
  type AssignmentResultDto,
} from '../dto/assignment.dto';
import {
  authorizationInput,
  authorizationIdString,
  parseAuthorizationModuleKey,
  AuthorizationUserParamsDto,
  AuthorizationRoleParamsDto,
  AuthorizationPageDto,
  parseAuthorizationId,
} from '../dto/authorization-query.dto';
import {
  AuthorizationManagementService,
  type AuthorizationManagementContext,
} from './authorization-management.service';
import { AuthorizationCatalogService } from './authorization-catalog.service';
import { AuthorizationAuditService } from './authorization-audit.service';
import { isProtectedRole } from '../authorization.catalog';

/** 預指派只沿用 Portal 有效身分；員工、一般角色關聯與稽核同交易保存。 */
@Injectable()
export class AuthorizationAssignmentService {
  constructor(
    private readonly management: AuthorizationManagementService,
    private readonly eligibleStaff: EligibleStaffService,
    private readonly users: UserRepository,
    private readonly repository: AuthorizationRepository,
    private readonly catalog: AuthorizationCatalogService,
    private readonly audit: AuthorizationAuditService,
  ) {}

  async assign(
    context: AuthorizationManagementContext,
    moduleKey: unknown,
    body: unknown,
  ): Promise<AssignmentResultDto> {
    const key = parseAuthorizationModuleKey(moduleKey);
    const input = authorizationInput(AssignmentDto, body);
    // 查上游前先驗操作者；上游 I/O 不占用本地交易或資料列鎖。
    await this.management.read(context, () => undefined);
    let staff: StaffLookupDto;
    try {
      staff = await this.eligibleStaff.lookupEligibleStaff(input.empId);
    } catch (error) {
      if (
        error instanceof AppException &&
        error.code === AppErrors.AUTH_EXCHANGE_FAILED[0]
      )
        throw new AppException(...AppErrors.AUTHORIZATION_EMPLOYEE_INELIGIBLE);
      throw error;
    }
    const wanted = input.roleIds
      .map(parseAuthorizationId)
      .sort((a, b) => a - b);
    const expected = input.expectedRoleIds
      .map(parseAuthorizationId)
      .sort((a, b) => a - b);
    // 首次登入可與預建競爭；唯一鍵仲裁後整筆重讀，不重用失敗交易。
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.management.transaction(
          context,
          async (manager, audit) => {
            let user = await this.users.findByEmpidForUpdate(
              input.empId,
              manager,
            );
            const created = !user;
            if (user) this.assertAssignableUser(user, input.empId);
            else
              user = await this.users.save(
                this.users.create(
                  {
                    empid: staff.person_empid,
                    name: staff.person_name,
                    departmentCode: staff.department_id,
                    departmentName: staff.department_name,
                    titleName: staff.title ?? undefined,
                    personStatus: String(staff.person_status),
                    isActive: true,
                  },
                  manager,
                ),
                manager,
              );
            // 固定 singleton → user → role id → permission id → relations。
            const roles = await this.repository.roles(manager, true);
            await this.repository.permissions(manager, true);
            await this.catalog.assertReady(manager);
            for (const id of new Set([...wanted, ...expected])) {
              const role = roles.find(
                (r) => r.id === id && r.moduleKey === key,
              );
              if (!role || (role.deletedAt && wanted.includes(id)))
                throw new AppException(
                  ...AppErrors.AUTHORIZATION_RESOURCE_NOT_FOUND,
                );
              if (isProtectedRole(role.moduleKey, role.roleCode))
                throw new AppException(
                  ...AppErrors.AUTHORIZATION_PROTECTED_ROLE,
                );
            }
            const current = await this.explicitRoleIds(user.id, key, manager);
            const same = equalIds(current, wanted);
            if (!same && !equalIds(current, expected))
              throw new AppException(
                ...AppErrors.AUTHORIZATION_VERSION_CONFLICT,
              );
            if (same && !created)
              return { ...this.view(user, key, current), changed: false };
            await this.repository.replaceUserRoles(
              user.id,
              key,
              wanted,
              manager,
            );
            await this.audit.append(
              {
                context: audit,
                moduleKey: key,
                eventType: 'user.roles_updated',
                targetKind: 'user',
                targetId: user.id,
                before: created ? null : { userId: user.id, roleIds: current },
                after: { userId: user.id, roleIds: wanted },
              },
              manager,
            );
            return { ...this.view(user, key, wanted), changed: true };
          },
        );
      } catch (error) {
        if (isDuplicateEntryError(error) && attempt === 0) continue;
        if (isDuplicateEntryError(error))
          throw new AppException(...AppErrors.AUTHORIZATION_UNAVAILABLE);
        throw error;
      }
    }
  }

  async employeeRoles(
    context: AuthorizationManagementContext,
    moduleKey: unknown,
    userId: unknown,
  ): Promise<EmployeeRolesDto> {
    const input = authorizationInput(AuthorizationUserParamsDto, {
      moduleKey,
      userId,
    });
    const key = parseAuthorizationModuleKey(input.moduleKey);
    return this.management.read(context, async (manager) => {
      const user = await this.users.findById(
        parseAuthorizationId(input.userId),
        manager,
      );
      if (!user || user.deletedAt)
        throw new AppException(...AppErrors.AUTHORIZATION_RESOURCE_NOT_FOUND);
      return this.view(
        user,
        key,
        await this.explicitRoleIds(user.id, key, manager),
      );
    });
  }

  async roleEmployees(
    context: AuthorizationManagementContext,
    moduleKey: unknown,
    roleId: unknown,
    query: unknown = {},
  ) {
    const input = authorizationInput(AuthorizationRoleParamsDto, {
      moduleKey,
      roleId,
    });
    const key = parseAuthorizationModuleKey(input.moduleKey);
    const page = authorizationInput(AuthorizationPageDto, query);
    return this.management.read(context, async (manager) => {
      const role = await this.repository.findRole(
        key,
        parseAuthorizationId(input.roleId),
        manager,
      );
      if (!role)
        throw new AppException(...AppErrors.AUTHORIZATION_RESOURCE_NOT_FOUND);
      const rows = await this.repository.roleEmployees(
        key,
        role.id,
        page.limit + 1,
        page.beforeId ? parseAuthorizationId(page.beforeId) : undefined,
        manager,
      );
      const items = rows.slice(0, page.limit).map((user) => ({
        userId: authorizationIdString(user.id),
        name: user.name,
      }));
      return {
        items,
        nextCursor:
          rows.length > page.limit ? (items.at(-1)?.userId ?? null) : null,
      };
    });
  }

  private assertAssignableUser(user: User, empId: string) {
    if (!user.isActive || user.deletedAt)
      throw new AppException(...AppErrors.ACCOUNT_DISABLED);
    if (user.empid !== empId)
      throw new AppException(...AppErrors.AUTHORIZATION_EMPLOYEE_INELIGIBLE);
  }
  private explicitRoleIds(
    userId: number,
    moduleKey: string,
    manager: EntityManager,
  ): Promise<number[]> {
    return this.repository.explicitRoleIds(userId, moduleKey, manager);
  }
  private view(
    user: User,
    moduleKey: string,
    roleIds: number[],
  ): EmployeeRolesDto {
    return {
      userId: authorizationIdString(user.id),
      moduleKey,
      roleIds: roleIds.map(authorizationIdString),
      implicitRoles:
        moduleKey === 'esign' && user.isActive
          ? [{ roleCode: 'colleague', source: 'baseline' }]
          : [],
    };
  }
}
function equalIds(a: readonly number[], b: readonly number[]) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
