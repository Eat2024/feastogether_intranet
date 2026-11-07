import { Controller, Get } from '@nestjs/common';
import { createAuthorizationHttpApp } from './helpers/authorization-http-fixtures';
import { Test } from '@nestjs/testing';
import { BullRegistrar } from '@nestjs/bullmq/dist/bull.registrar';
import { WorkerModule } from '#app/worker.module';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { SuperUserAccessScheduler } from '#app/worker/auth/super-user-access.scheduler';
import { AuthenticatedOnly } from '#app/features/authorization/decorators/require-permissions.decorator';
import { AuthorizationReadinessService } from '#app/features/authorization/services/authorization-readiness.service';
import { authorizationServices } from './helpers/authorization-fixtures';
import { createAuthorizationSession } from './helpers/authorization-http-fixtures';
import {
  withAuthorizationDatabase,
  seedAuthorizationCatalog,
} from './helpers/authorization-fixtures';

@Controller('unclassified')
class UnclassifiedController {
  @Get() read(this: void) {
    return 'unexpected';
  }
}

describe('028 HTTP 啟動拒絕不完整授權', () => {
  jest.setTimeout(120_000);
  it('缺目錄拒絕啟動，不由 GET 或啟動補種目錄', async () => {
    await withAuthorizationDatabase(async (db) => {
      await expect(createAuthorizationHttpApp(db)).rejects.toThrow('授權');
    });
  });
  it('完整目錄仍拒絕未分類的實際 controller', async () => {
    await withAuthorizationDatabase(async (db) => {
      await seedAuthorizationCatalog(db);
      await expect(
        createAuthorizationHttpApp(db, [UnclassifiedController]),
      ).rejects.toThrow('授權');
    });
  });
});

it('真 WorkerModule 在 InstanceLoader 拒絕缺目錄，早於 queue consumer 與排程註冊', async () => {
  await withAuthorizationDatabase(async (db) => {
    const consumers = jest.spyOn(BullRegistrar.prototype, 'onModuleInit');
    const schedules = jest.spyOn(
      SuperUserAccessScheduler.prototype,
      'onModuleInit',
    );
    try {
      await expect(
        Test.createTestingModule({ imports: [WorkerModule] })
          .overrideProvider(MYSQL_MAIN)
          .useValue(db)
          .compile(),
      ).rejects.toThrow('授權');
      expect(consumers).not.toHaveBeenCalled();
      expect(schedules).not.toHaveBeenCalled();
    } finally {
      jest.restoreAllMocks();
    }
  });
});

@Controller('classified-runtime')
class RuntimeController {
  @AuthenticatedOnly() @Get() read(this: void) {
    return 'unexpected';
  }
}

it('啟動後metadata遭不合法mode污染仍由guard fail closed', async () => {
  await withAuthorizationDatabase(async (db) => {
    await seedAuthorizationCatalog(db);
    await db.query(
      "INSERT INTO users(empid,name) VALUES('AZRUNTIME','合成員工')",
    );
    const app = await createAuthorizationHttpApp(db, [RuntimeController]);
    try {
      const cookie = await createAuthorizationSession(app, {
        kind: 'employee',
        userId: 1,
      });
      Reflect.defineMetadata(
        'authorizationRequirement',
        { mode: 'typo' },
        RuntimeController.prototype.read,
      );
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/classified-runtime',
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(503);
    } finally {
      Reflect.defineMetadata(
        'authorizationRequirement',
        { mode: 'authenticated' },
        RuntimeController.prototype.read,
      );
      await app.close();
    }
  });
});

it.each(['schema', 'future-schema', 'catalog'] as const)(
  '%s 與程式版本不一致拒絕啟動，唯讀檢查不補種',
  async (part) => {
    await withAuthorizationDatabase(async (db) => {
      await seedAuthorizationCatalog(db);
      if (part === 'schema')
        await db.query('DELETE FROM migrations ORDER BY id DESC LIMIT 1');
      else if (part === 'future-schema')
        await db.query(
          "INSERT INTO migrations(timestamp,name) VALUES(9999999999999,'UnknownFuture9999999999999')",
        );
      else
        await db.query(
          "UPDATE authorization_permissions SET permission_name='不相容版本' WHERE permission_key='esign.document.read'",
        );
      const { mysql, catalog } = authorizationServices(db);
      const before = await db.query<Array<Record<string, unknown>>>(
        'SELECT * FROM authorization_permissions',
      );
      await expect(
        new AuthorizationReadinessService(mysql, catalog).assertReady(),
      ).rejects.toThrow('授權');
      expect(await db.query('SELECT * FROM authorization_permissions')).toEqual(
        before,
      );
      await expect(createAuthorizationHttpApp(db)).rejects.toThrow('授權');
    });
  },
);
