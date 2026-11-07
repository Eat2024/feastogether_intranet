import { AuthorizationAssignmentService } from '#app/features/authorization/services/authorization-assignment.service';
import { AuthorizationRoleService } from '#app/features/authorization/services/authorization-role.service';
import { AuthorizationEventService } from '#app/features/authorization/services/authorization-event.service';
import { AuthorizationResolverService } from '#app/features/authorization/services/authorization-resolver.service';
import type { INestApplicationContext } from '@nestjs/common';
import { AuthorizationCatalogService } from '#app/features/authorization/services/authorization-catalog.service';

/** 只暴露業務閉包，不將 service、repository 或 DataSource 放入 REPL。 */
export function createAuthorizationConsole(app: INestApplicationContext) {
  const catalog = app.get(AuthorizationCatalogService);
  const resolver = app.get(AuthorizationResolverService);
  const roles = app.get(AuthorizationRoleService);
  const events = app.get(AuthorizationEventService);
  const assignments = app.get(AuthorizationAssignmentService);
  const context = { source: 'repl' } as const;
  return {
    assignRoles: (moduleKey: string, input: unknown) =>
      assignments.assign(context, moduleKey, input),
    employeeRoles: (moduleKey: string, userId: string) =>
      assignments.employeeRoles(context, moduleKey, userId),
    roleEmployees: (moduleKey: string, roleId: string, page: unknown = {}) =>
      assignments.roleEmployees(context, moduleKey, roleId, page),
    modules: () => roles.modules(context),
    permissions: (moduleKey: string) => roles.permissions(context, moduleKey),
    roles: (moduleKey: string, page: unknown = {}) =>
      roles.list(context, moduleKey, page),
    rolePermissions: (moduleKey: string, roleId: string) =>
      roles.detail(context, moduleKey, roleId),
    createRole: (moduleKey: string, input: unknown) =>
      roles.create(context, moduleKey, input),
    updateRole: (moduleKey: string, roleId: string, input: unknown) =>
      roles.update(context, moduleKey, roleId, input),
    deleteRole: (moduleKey: string, roleId: string, expectedVersion: number) =>
      roles.delete(context, moduleKey, roleId, { expectedVersion }),
    setRolePermissions: (moduleKey: string, roleId: string, input: unknown) =>
      roles.setPermissions(context, moduleKey, roleId, input),
    events: (query: unknown = {}) => events.list(context, query),
    syncCatalog: () => catalog.syncCatalog(),
    userPermissions: (userId: number) => resolver.userPermissions(userId),
  };
}
