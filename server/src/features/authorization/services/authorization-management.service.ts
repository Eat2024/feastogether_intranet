import { isDuplicateEntryError } from '#app/features/auth/repositories/oauth-identity.repository';
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { Actor } from '#app/features/auth/auth.types';
import { AppException } from '#app/common/errors/app.exception';
import { AppErrors } from '#app/common/errors/app-errors';
import { SuperUserAccessRepository } from '#app/features/auth/repositories/super-user-access.repository';
import { SuperUserConfigService } from '#app/features/auth/services/super-user-config.service';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { AuthorizationCatalogService } from './authorization-catalog.service';
import type { AuthorizationAuditContext } from './authorization-audit.service';

export type AuthorizationManagementContext =
  | { source: 'http'; actor: Actor; requestId?: string }
  | { source: 'repl' };
/** 管理 API／console 共用的維護身分與交易邊界。 */
@Injectable()
export class AuthorizationManagementService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly access: SuperUserAccessRepository,
    private readonly config: SuperUserConfigService,
    private readonly catalog: AuthorizationCatalogService,
  ) {}
  private async generation(context: AuthorizationManagementContext) {
    if (context.source === 'http' && context.actor.kind !== 'super_user')
      throw new AppException(...AppErrors.AUTHORIZATION_DENIED);
    const access = await this.access.find(this.mysql.getManager());
    if (
      !access ||
      access.activeCredentialFingerprint !== this.config.fingerprint
    )
      throw new AppException(...AppErrors.AUTH_SUPER_USER_UNAVAILABLE);
    return access.credentialGeneration;
  }
  async read<T>(
    context: AuthorizationManagementContext,
    run: (manager: EntityManager) => T | Promise<T>,
  ): Promise<T> {
    try {
      await this.generation(context);
      await this.catalog.assertReady();
      return await run(this.mysql.getManager());
    } catch (error) {
      if (error instanceof AppException) throw error;
      throw new AppException(...AppErrors.AUTHORIZATION_UNAVAILABLE);
    }
  }
  async transaction<T>(
    context: AuthorizationManagementContext,
    run: (
      manager: EntityManager,
      audit: AuthorizationAuditContext,
    ) => Promise<T>,
  ): Promise<T> {
    try {
      const generation = await this.generation(context);
      return await this.mysql.transaction(async (manager) => {
        // 所有維護異動先鎖 singleton，再依 users → role id → permission id → relations。
        // 呼叫者須先取得將修改的角色排他鎖，不能先取得 catalog 的 shared role lock 再升鎖。
        const access = await this.access.findForUpdate(manager);
        if (
          !access ||
          access.credentialGeneration !== generation ||
          access.activeCredentialFingerprint !== this.config.fingerprint
        )
          throw new AppException(...AppErrors.AUTH_SUPER_USER_UNAVAILABLE);
        return run(manager, {
          actorKind: context.source === 'http' ? 'super_user' : 'operator',
          source: context.source,
          requestId: context.source === 'http' ? context.requestId : undefined,
        });
      }, 'READ COMMITTED');
    } catch (error) {
      if (error instanceof AppException || isDuplicateEntryError(error))
        throw error;
      throw new AppException(...AppErrors.AUTHORIZATION_UNAVAILABLE);
    }
  }
}
