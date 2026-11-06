import { Test } from '@nestjs/testing';
import { ModulesContainer } from '@nestjs/core';
import { ConsoleModule } from '#app/console/console.module';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { createAuthorizationConsole } from '#app/console/helpers/authorization.helpers';
import { AuthorizationRole } from '#app/features/authorization/entities/authorization-role.entity';
import {
  withAuthorizationDatabase,
  authorizationServices,
  initializeAuthorizationOperator,
} from './helpers/authorization-fixtures';

describe('028 明確 catalog sync 與交易稽核', () => {
  jest.setTimeout(120_000);
  it('讀取缺失目錄回 unavailable、沒有初始化副作用；兩次 sync 不覆寫一般角色或 no-op audit', async () => {
    await withAuthorizationDatabase(async (db) => {
      const { catalog, repository, events } =
        await initializeAuthorizationOperator(db);
      await expect(catalog.assertReady()).rejects.toThrow(
        '授權服務暫時無法使用',
      );
      expect(await repository.roles(db.manager)).toEqual([]);
      expect(await catalog.syncCatalog()).toEqual({ changed: true });
      await expect(catalog.assertReady()).resolves.toBeUndefined();
      const creator = (await repository.roles(db.manager)).find(
        (r) => r.roleCode === 'document_creator',
      );
      if (!creator) throw new Error('缺少測試角色');
      creator.isActive = false;
      creator.roleName = '自訂建立者';
      await db.manager.save(creator);
      await db.transaction((m) =>
        repository.replaceRolePermissions(creator, [], m),
      );
      const beforeEvents = await events.list(db.manager, { limit: 100 });
      expect(await catalog.syncCatalog()).toEqual({ changed: false });
      expect(await events.list(db.manager, { limit: 100 })).toEqual(
        beforeEvents,
      );
      expect(
        await db.manager.findOneByOrFail(AuthorizationRole, { id: creator.id }),
      ).toMatchObject({ roleName: '自訂建立者', isActive: false });
      expect(
        (await repository.rolePermissions([creator.id], db.manager)).filter(
          (r) => !r.deletedAt,
        ),
      ).toHaveLength(0);
      expect(
        await db.query(
          'SELECT COUNT(*) AS count FROM authorization_user_roles',
        ),
      ).toEqual([{ count: 0 }]);
    });
  });
  it('並發初始化只建立一次；受保護同仁修復，移除目錄 soft-delete', async () => {
    await withAuthorizationDatabase(async (db) => {
      const { catalog, repository } = await initializeAuthorizationOperator(db);
      const other = authorizationServices(db).catalog;
      const results = await Promise.all([
        catalog.syncCatalog(),
        other.syncCatalog(),
      ]);
      expect(results.filter((r) => r.changed)).toHaveLength(1);
      expect(await repository.roles(db.manager)).toHaveLength(3);
      await db.query(
        "INSERT INTO authorization_permissions (module_key,permission_key,permission_name,assignable) VALUES ('esign','esign.retired','已移除',1)",
      );
      await db.query(
        "UPDATE authorization_roles SET is_active=0 WHERE role_code='colleague'",
      );
      await expect(catalog.assertReady()).rejects.toThrow(
        '授權服務暫時無法使用',
      );
      expect(await catalog.syncCatalog()).toEqual({ changed: true });
      await expect(catalog.assertReady()).resolves.toBeUndefined();
      expect(
        (await repository.permissions(db.manager)).find(
          (p) => p.permissionKey === 'esign.retired',
        )?.deletedAt,
      ).toBeInstanceOf(Date);
    });
  });
  it('稽核資料庫失敗使整個初始化回滾；過期維護設定拒絕寫入', async () => {
    await withAuthorizationDatabase(async (db) => {
      const { catalog, repository } = await initializeAuthorizationOperator(db);
      await db.query(
        "CREATE TRIGGER authorization_audit_failure BEFORE INSERT ON authorization_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='測試稽核寫入失敗'",
      );
      await expect(catalog.syncCatalog()).rejects.toThrow('測試稽核寫入失敗');
      expect(await repository.roles(db.manager)).toEqual([]);
      expect(await repository.permissions(db.manager)).toEqual([]);
      await db.query('DROP TRIGGER authorization_audit_failure');
      await db.query(
        'UPDATE super_user_access SET active_credential_fingerprint=?,credential_generation=2',
        ['b'.repeat(64)],
      );
      await expect(catalog.syncCatalog()).rejects.toThrow();
      expect(await repository.permissions(db.manager)).toEqual([]);
    });
  });
});

it('隔離 ConsoleModule 只以閉包提供 authz，同服務初始化且無 HTTP／worker／外部連線模組', async () => {
  await withAuthorizationDatabase(async (db) => {
    await initializeAuthorizationOperator(db);
    const app = await Test.createTestingModule({ imports: [ConsoleModule] })
      .overrideProvider(MYSQL_MAIN)
      .useValue(db)
      .compile();
    try {
      await app.init();
      const modules = [...app.get(ModulesContainer).values()].map(
        (m) => m.metatype.name,
      );
      for (const forbidden of [
        'AppModule',
        'WorkerModule',
        'PortalModule',
        'RedisModule',
        'MailModule',
        'FileStorageModule',
      ])
        expect(modules).not.toContain(forbidden);
      const authz = createAuthorizationConsole(app);
      expect(
        Object.values(authz).every((value) => typeof value === 'function'),
      ).toBe(true);
      await expect(authz.syncCatalog()).resolves.toEqual({ changed: true });
      await expect(authz.syncCatalog()).resolves.toEqual({ changed: false });
    } finally {
      await app.close();
    }
  });
});

it('REPL 唯讀查詢與 resolver 一致，明確角色與 baseline 重疊時兩種來源都保留', async () => {
  await withAuthorizationDatabase(async (db) => {
    const { catalog, repository, events } =
      await initializeAuthorizationOperator(db);
    await catalog.syncCatalog();
    await db.query(
      "INSERT INTO users (empid,name) VALUES ('AZ-CONSOLE','合成維運查詢員工')",
    );
    const admin = (await repository.roles(db.manager)).find(
      (r) => r.roleCode === 'esign_admin',
    )!;
    await db.transaction((m) =>
      repository.replaceUserRoles(1, 'esign', [admin.id], m),
    );
    const app = await Test.createTestingModule({ imports: [ConsoleModule] })
      .overrideProvider(MYSQL_MAIN)
      .useValue(db)
      .compile();
    try {
      await app.init();
      const authz = createAuthorizationConsole(app);
      const before = await events.list(db.manager, { limit: 100 });
      const view = await authz.userPermissions(1);
      expect(view.sources.baseline[0].permissions).toEqual([
        'esign.document.read',
        'esign.signing.copy',
        'esign.signing.read',
        'esign.signing.submit',
      ]);
      expect(view.sources.explicit[0].permissions).toContain(
        'esign.signing.copy',
      );
      expect(view.sources.explicit[0].permissions).toHaveLength(11);
      expect(view.modules[0].permissions).toHaveLength(11);
      expect(await events.list(db.manager, { limit: 100 })).toEqual(before);
      await expect(
        authz.userPermissions(Number.MAX_SAFE_INTEGER + 1),
      ).rejects.toThrow();
    } finally {
      await app.close();
    }
  });
});
