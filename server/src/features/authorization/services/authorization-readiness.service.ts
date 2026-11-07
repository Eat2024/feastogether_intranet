import { Injectable, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MetadataScanner, Reflector } from '@nestjs/core';
import { AppException } from '#app/common/errors/app.exception';
import { AppErrors } from '#app/common/errors/app-errors';
import { IS_PUBLIC_KEY } from '#app/framework/decorators/public.decorator';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { AUTHORIZATION_PERMISSIONS } from '../authorization.catalog';
import {
  AUTHORIZATION_REQUIREMENT,
  type AuthorizationRequirement,
} from '../decorators/require-permissions.decorator';
import { AuthorizationCatalogService } from './authorization-catalog.service';

const knownPermissions = new Set<string>(
  AUTHORIZATION_PERMISSIONS.map((p) => p.permissionKey),
);

/** Metadata 為 runtime 輸入；不能僅依 TypeScript union 信任宣告。 */
export function isAuthorizationRequirement(
  value: unknown,
): value is AuthorizationRequirement {
  if (!value || typeof value !== 'object' || !('mode' in value)) return false;
  if (value.mode === 'authenticated' || value.mode === 'super') return true;
  return (
    (value.mode === 'all' || value.mode === 'any') &&
    'permissions' in value &&
    Array.isArray(value.permissions) &&
    value.permissions.length > 0 &&
    value.permissions.every(
      (key: unknown) => typeof key === 'string' && knownPermissions.has(key),
    )
  );
}

/** 啟用前檢查實際 controller 方法；不以缺少宣告代表登入即可。 */
export function validateAuthorizationRoutes(
  controllers: readonly Type[],
): void {
  const scanner = new MetadataScanner();
  const reflector = new Reflector();
  for (const controller of controllers) {
    const prototype = controller.prototype as Record<string, unknown>;
    for (const name of scanner.getAllMethodNames(prototype)) {
      const handler = prototype[name];
      if (
        typeof handler !== 'function' ||
        !Reflect.hasMetadata(METHOD_METADATA, handler) ||
        !Reflect.hasMetadata(PATH_METADATA, handler)
      )
        continue;
      const targets = [handler, controller];
      if (reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets))
        continue;
      const requirement = reflector.getAllAndOverride<AuthorizationRequirement>(
        AUTHORIZATION_REQUIREMENT,
        targets,
      );
      if (!isAuthorizationRequirement(requirement)) {
        throw new AppException(...AppErrors.AUTHORIZATION_UNAVAILABLE);
      }
    }
  }
}

/** 唯讀啟動檢查；HTTP 與 worker 使用，console 仍可在目錄缺失時明確 sync。 */
@Injectable()
export class AuthorizationReadinessService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly catalog: AuthorizationCatalogService,
  ) {}
  async assertReady(): Promise<void> {
    try {
      const source = this.mysql.getDataSource();
      const executed = await source
        .createQueryBuilder()
        .select('name')
        .from(source.options.migrationsTableName ?? 'migrations', 'migration')
        .getRawMany<{ name: string }>();
      const expected = source.migrations.map(
        (migration) => migration.name ?? migration.constructor.name,
      );
      if (
        executed.length !== expected.length ||
        expected.some(
          (name) => !executed.some((migration) => migration.name === name),
        )
      )
        throw new Error('授權 schema 版本不一致');
      await this.catalog.assertReady();
    } catch {
      throw new AppException(...AppErrors.AUTHORIZATION_UNAVAILABLE);
    }
  }
}
