import { applyDecorators, SetMetadata } from '@nestjs/common';
import { AllowSuperUser } from '#app/framework/decorators/allow-super-user.decorator';
import type { PermissionKey } from '../authorization.catalog';

export const AUTHORIZATION_REQUIREMENT = 'authorizationRequirement';
export type AuthorizationRequirement =
  | { mode: 'authenticated' | 'super' }
  | { mode: 'all' | 'any'; permissions: readonly PermissionKey[] };

/** 所有列出的能力都必須成立；Super 相容由業務入口另行明確宣告。 */
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(AUTHORIZATION_REQUIREMENT, {
    mode: 'all',
    permissions,
  } satisfies AuthorizationRequirement);
/** 簽署候選人等明確允許任一能力的入口。 */
export const RequireAnyPermission = (...permissions: PermissionKey[]) =>
  SetMetadata(AUTHORIZATION_REQUIREMENT, {
    mode: 'any',
    permissions,
  } satisfies AuthorizationRequirement);
export const AuthenticatedOnly = () =>
  applyDecorators(
    AllowSuperUser(),
    SetMetadata(AUTHORIZATION_REQUIREMENT, {
      mode: 'authenticated',
    } satisfies AuthorizationRequirement),
  );
export const SuperUserOnly = () =>
  applyDecorators(
    AllowSuperUser(),
    SetMetadata(AUTHORIZATION_REQUIREMENT, {
      mode: 'super',
    } satisfies AuthorizationRequirement),
  );
