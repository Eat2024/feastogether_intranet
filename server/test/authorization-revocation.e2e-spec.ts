import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  RequirePermissions,
  RequireAnyPermission,
  SuperUserOnly,
  AuthenticatedOnly,
} from '#app/features/authorization/decorators/require-permissions.decorator';
import { AuthorizationService } from '#app/features/authorization/services/authorization.service';
import { AuthorizationResolverService } from '#app/features/authorization/services/authorization-resolver.service';
import { AllowSuperUser } from '#app/framework/decorators/allow-super-user.decorator';
import {
  withAuthorizationDatabase,
  initializeAuthorizationOperator,
} from './helpers/authorization-fixtures';
import {
  createAuthorizationHttpApp,
  createAuthorizationSession,
} from './helpers/authorization-http-fixtures';

@Controller('test-authorization')
class PermissionProbeController {
  @Get('create') @RequirePermissions('esign.document.create') create() {
    return 'allowed';
  }
  @Get('all')
  @RequirePermissions('esign.document.create', 'esign.export.create')
  all() {
    return 'allowed';
  }
  @Get('any')
  @RequireAnyPermission('esign.document.create', 'esign.document.manage')
  any() {
    return 'allowed';
  }
  @Get('super') @SuperUserOnly() superOnly() {
    return 'allowed';
  }
  @Get('authenticated') @AuthenticatedOnly() authenticated() {
    return 'allowed';
  }
  @Get('super-compatible')
  @AllowSuperUser()
  @RequirePermissions('esign.document.create')
  superCompatible() {
    return 'allowed';
  }
}

describe('028 多實例即時撤權與 current read', () => {
  jest.setTimeout(120_000);
  it('兩個真實 session 實例看最新角色／permission／assignment，重複 grant 撤一仍保留', async () => {
    await withAuthorizationDatabase(async (db) => {
      const { catalog, repository } = await initializeAuthorizationOperator(db);
      await catalog.syncCatalog();
      await db.query(
        "INSERT INTO users (empid,name) VALUES ('AZ-U','合成員工')",
      );
      const roles = await repository.roles(db.manager);
      const creator = roles.find((r) => r.roleCode === 'document_creator')!;
      const admin = roles.find((r) => r.roleCode === 'esign_admin')!;
      const other = await new DataSource(db.options).initialize();
      const a = await createAuthorizationHttpApp(db, [
        PermissionProbeController,
      ]);
      const b = await createAuthorizationHttpApp(other, [
        PermissionProbeController,
      ]);
      try {
        const cookie = await createAuthorizationSession(
          a,
          { kind: 'employee', userId: 1 },
          'oauth',
        );
        const read = async (path: string, status: number) => {
          for (const app of [a, b])
            expect(
              (
                await app.inject({
                  method: 'GET',
                  url: '/api/test-authorization/' + path,
                  headers: { cookie },
                })
              ).statusCode,
            ).toBe(status);
        };
        await read('authenticated', 200);
        await read('create', 403);
        await read('super', 403);
        const superCookie = await createAuthorizationSession(a, {
          kind: 'super_user',
        });
        for (const app of [a, b]) {
          for (const path of ['super', 'super-compatible', 'authenticated'])
            expect(
              (
                await app.inject({
                  method: 'GET',
                  url: '/api/test-authorization/' + path,
                  headers: { cookie: superCookie },
                })
              ).statusCode,
            ).toBe(200);
          expect(
            (
              await app.inject({
                method: 'GET',
                url: '/api/test-authorization/create',
                headers: { cookie: superCookie },
              })
            ).statusCode,
          ).toBe(403);
        }

        await db.transaction((m) =>
          repository.replaceUserRoles(1, 'esign', [creator.id, admin.id], m),
        );
        await read('create', 200);
        await read('all', 200);
        await read('any', 200);
        await read('super', 403);
        creator.isActive = false;
        await repository.saveRole(creator, db.manager);
        await read('create', 200);
        admin.isActive = false;
        await repository.saveRole(admin, db.manager);
        await read('create', 403);
        creator.isActive = true;
        await repository.saveRole(creator, db.manager);
        await read('create', 200);
        const permissions = await repository.permissions(db.manager);
        const create = permissions.find(
          (p) => p.permissionKey === 'esign.document.create',
        )!;
        await db.transaction((m) =>
          repository.replaceRolePermissions(creator, [create.id], m),
        );
        await read('all', 403);
        await read('any', 200);
        await db.transaction((m) =>
          repository.replaceUserRoles(1, 'esign', [], m),
        );
        await read('create', 403);
        await db.transaction((m) =>
          repository.replaceUserRoles(1, 'esign', [creator.id], m),
        );
        await read('create', 200);
        creator.deletedAt = new Date();
        await repository.saveRole(creator, db.manager);
        await read('create', 403);
        const response = await b.inject({
          method: 'GET',
          url: '/api/auth/me',
          headers: { cookie },
        });
        expect(response.statusCode).toBe(200);
        expect(
          response.json<{ data: { modules: unknown } }>().data.modules,
        ).toEqual([
          {
            moduleKey: 'esign',
            permissions: [
              'esign.document.read',
              'esign.signing.copy',
              'esign.signing.read',
              'esign.signing.submit',
            ],
          },
        ]);
      } finally {
        await b.close();
        await a.close();
      }
    });
  });
  it('長 REPEATABLE READ 交易已有舊快照，撤權提交後仍拒絕新業務授權', async () => {
    await withAuthorizationDatabase(async (db) => {
      const { catalog, repository } = await initializeAuthorizationOperator(db);
      await catalog.syncCatalog();
      await db.query(
        "INSERT INTO users (empid,name) VALUES ('AZ-RR','合成員工')",
      );
      const creator = (await repository.roles(db.manager)).find(
        (r) => r.roleCode === 'document_creator',
      )!;
      await db.transaction((m) =>
        repository.replaceUserRoles(1, 'esign', [creator.id], m),
      );
      const app = await createAuthorizationHttpApp(db);
      const runner = db.createQueryRunner();
      await runner.connect();
      await runner.startTransaction('REPEATABLE READ');
      try {
        await runner.manager.query('SELECT * FROM authorization_user_roles');
        await db.transaction((m) =>
          repository.replaceUserRoles(1, 'esign', [], m),
        );
        await expect(
          app
            .get(AuthorizationService)
            .requirePermissions(
              { kind: 'employee', userId: 1 },
              ['esign.document.create'],
              runner.manager,
            ),
        ).rejects.toThrow('您沒有執行此操作的權限');
        expect(
          (
            await app
              .get(AuthorizationResolverService)
              .resolve({ kind: 'employee', userId: 1 }, runner.manager)
          ).modules[0].permissions,
        ).toHaveLength(4);
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
        await app.close();
      }
    });
  });
});
