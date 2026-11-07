import {
  withAuthorizationDatabase,
  createAuthorizationScopeFixtures,
} from './helpers/authorization-fixtures';
import { AuthorizationRole } from '#app/features/authorization/entities/authorization-role.entity';
import { AuthorizationRepository } from '#app/features/authorization/repositories/authorization.repository';

describe('028 授權資料約束', () => {
  jest.setTimeout(120_000);
  it('空庫可 up/down/reapply；授權表存在且 entity 沒有 schema drift', async () => {
    await withAuthorizationDatabase(async (db) => {
      expect(
        await db.query('SELECT COUNT(*) AS count FROM authorization_roles'),
      ).toEqual([{ count: 0 }]);
      await db.undoLastMigration(); // 文件 actor migration
      await db.undoLastMigration(); // 授權 schema
      await expect(
        db.query('SELECT * FROM authorization_roles'),
      ).rejects.toThrow();
      await db.runMigrations();
      expect((await db.driver.createSchemaBuilder().log()).upQueries).toEqual(
        [],
      );
    });
  });
});

describe('028 複合 scope 與歷史資料', () => {
  jest.setTimeout(120_000);
  it('不同 module 同名角色允許；雙側 scope FK 拒絕權限與指派偽造', async () => {
    await withAuthorizationDatabase(async (db) => {
      await createAuthorizationScopeFixtures(db);
      await db.query(
        "INSERT INTO authorization_role_permissions (module_key,role_id,permission_id) VALUES ('esign',1,1)",
      );
      await expect(
        db.query(
          "INSERT INTO authorization_role_permissions (module_key,role_id,permission_id) VALUES ('esign',1,2)",
        ),
      ).rejects.toThrow();
      await expect(
        db.query(
          "INSERT INTO authorization_role_permissions (module_key,role_id,permission_id) VALUES ('test-module',1,2)",
        ),
      ).rejects.toThrow();
      await expect(
        db.query(
          "INSERT INTO authorization_user_roles (user_id,module_key,role_id) VALUES (1,'esign',2)",
        ),
      ).rejects.toThrow();
      await db.query(
        "INSERT INTO authorization_user_roles (user_id,module_key,role_id) VALUES (1,'test-module',2)",
      );
      await expect(db.query('DELETE FROM users WHERE id=1')).rejects.toThrow();
    });
  });
  it('同名競爭只成功一次；停用仍占名、刪除後名稱可重用但 code 不可', async () => {
    await withAuthorizationDatabase(async (db) => {
      const results = await Promise.allSettled(
        ['one', 'two'].map((code) =>
          db.query(
            "INSERT INTO authorization_roles (module_key,role_code,role_name) VALUES ('esign',?,'名稱')",
            [code],
          ),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const [role] = await db.manager.find(AuthorizationRole);
      await db.query('UPDATE authorization_roles SET is_active=0 WHERE id=?', [
        role.id,
      ]);
      await expect(
        db.query(
          "INSERT INTO authorization_roles (module_key,role_code,role_name) VALUES ('esign','three','名稱')",
        ),
      ).rejects.toThrow();
      await db.query(
        'UPDATE authorization_roles SET deleted_at=NOW(6) WHERE id=?',
        [role.id],
      );
      await db.query(
        "INSERT INTO authorization_roles (module_key,role_code,role_name) VALUES ('esign','three','名稱')",
      );
      await expect(
        db.query(
          "INSERT INTO authorization_roles (module_key,role_code,role_name) VALUES ('esign',?,'另一名稱')",
          [role.roleCode],
        ),
      ).rejects.toThrow();
    });
  });
  it('權限關聯撤銷與重授恢復同列，不插入重複歷史列', async () => {
    await withAuthorizationDatabase(async (db) => {
      await createAuthorizationScopeFixtures(db);
      const repository = new AuthorizationRepository();
      const role = await db.manager.findOneByOrFail(AuthorizationRole, {
        id: 1,
      });
      await db.transaction((m) =>
        repository.replaceRolePermissions(role, [1], m),
      );
      const [before] = await repository.rolePermissions([1], db.manager);
      await db.transaction((m) =>
        repository.replaceRolePermissions(role, [], m),
      );
      expect(
        (await repository.rolePermissions([1], db.manager))[0].deletedAt,
      ).toBeInstanceOf(Date);
      await db.transaction((m) =>
        repository.replaceRolePermissions(role, [1], m),
      );
      const rows = await repository.rolePermissions([1], db.manager);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(before.id);
      expect(rows[0].deletedAt).toBeNull();
    });
  });
  it('員工角色撤銷與重授恢復同列，其他 scope 不受影響', async () => {
    await withAuthorizationDatabase(async (db) => {
      await createAuthorizationScopeFixtures(db);
      const repository = new AuthorizationRepository();
      await db.transaction((m) =>
        repository.replaceUserRoles(1, 'esign', [1], m),
      );
      await db.transaction((m) =>
        repository.replaceUserRoles(1, 'test-module', [2], m),
      );
      const original = await repository.userRoles(1, db.manager);
      await db.transaction((m) =>
        repository.replaceUserRoles(1, 'esign', [], m),
      );
      expect(
        (await repository.userRoles(1, db.manager)).map((r) => r.moduleKey),
      ).toEqual(['test-module']);
      await db.transaction((m) =>
        repository.replaceUserRoles(1, 'esign', [1], m),
      );
      expect(
        (await repository.userRoles(1, db.manager)).map((r) => r.id),
      ).toEqual(original.map((r) => r.id));
    });
  });
  it('只有稽核、沒有 Super 業務資料也拒絕 down，原資料不變', async () => {
    await withAuthorizationDatabase(async (db) => {
      await db.query(
        "INSERT INTO authorization_events (occurred_at,actor_kind,source,module_key,event_type,target_kind) VALUES (NOW(6),'system','migration','esign','catalog.synced','catalog')",
      );
      await expect(db.undoLastMigration()).rejects.toThrow('無法回滾');
      expect(
        await db.query('SELECT COUNT(*) AS count FROM authorization_events'),
      ).toEqual([{ count: 1 }]);
    });
  });
});
