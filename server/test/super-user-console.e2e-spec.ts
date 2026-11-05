import type { INestApplicationContext } from '@nestjs/common';
import { ModulesContainer, NestFactory } from '@nestjs/core';
import type { DataSource } from 'typeorm';
import { AppModule } from '#app/app.module';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { ConsoleModule } from '#app/console/console.module';
import { createAuthConsole } from '#app/console/repl';
import { AuthModule } from '#app/features/auth/auth.module';
import {
  latestDueRotationPeriod,
  nextRotationPeriod,
} from '#app/features/auth/helpers/rotation-period';
import { AuthSecurityEventRepository } from '#app/features/auth/repositories/auth-security-event.repository';
import { SuperUserAccessRepository } from '#app/features/auth/repositories/super-user-access.repository';
import { SuperUserConfigService } from '#app/features/auth/services/super-user-config.service';
import { FrameworkModule } from '#app/framework/framework.module';
import { BullRootModule } from '#app/infrastructure/bullmq/bull-root.module';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { RedisModule } from '#app/infrastructure/database/redis/redis.module';
import { FileStorageModule } from '#app/infrastructure/file-storage/file-storage.module';
import { InfrastructureModule } from '#app/infrastructure/infrastructure.module';
import { MailModule } from '#app/infrastructure/mail/mail.module';
import { PortalModule } from '#app/infrastructure/portal/portal.module';
import { WorkerModule } from '#app/worker.module';

interface AccessRow {
  id: number;
  entry_key: string;
  entry_generation: number;
  rotated_at: Date;
  period_start_at: Date;
  active_credential_fingerprint: string;
  credential_generation: number;
  credential_activated_at: Date;
}

/** 真正 REPL 使用的 ConsoleModule 與 auth helpers，對受保護的隔離測試庫驗證初始化與查詢。 */
describe('窄 REPL 維護入口初始化與查詢', () => {
  let app: INestApplicationContext;
  let db: DataSource;
  let auth: ReturnType<typeof createAuthConsole>;

  const accessRows = () =>
    db.query<AccessRow[]>('SELECT * FROM super_user_access');
  const operatorEvents = () =>
    db.query<Array<Record<string, unknown>>>(
      `SELECT event_type, actor_kind, actor_user_id, session_id, outcome_code,
        credential_generation, entry_generation, request_id
        FROM auth_security_events WHERE actor_kind = 'operator' ORDER BY id`,
    );
  const snapshot = async () => ({
    access: await accessRows(),
    events: await operatorEvents(),
  });

  beforeAll(async () => {
    app = await NestFactory.createApplicationContext(ConsoleModule, {
      logger: false,
    });
    db = app.get<DataSource>(MYSQL_MAIN);
    auth = createAuthConsole(app);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await db.query(
      "DELETE FROM auth_security_events WHERE actor_kind = 'operator'",
    );
    await db.query('DELETE FROM super_user_access');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('不載入 HTTP、worker、queue、Portal、mail、storage 或 Redis 模組，啟動不自動初始化', async () => {
    const loaded = new Set(
      [...app.get(ModulesContainer).values()].map(
        (moduleRef) => moduleRef.metatype,
      ),
    );
    for (const excluded of [
      AppModule,
      WorkerModule,
      FrameworkModule,
      InfrastructureModule,
      AuthModule,
      BullRootModule,
      RedisModule,
      PortalModule,
      MailModule,
      FileStorageModule,
    ]) {
      expect(loaded.has(excluded)).toBe(false);
    }
    expect(await snapshot()).toEqual({ access: [], events: [] });
  });

  it('REPL 只拿到三個 auth helpers', () => {
    expect(Object.keys(auth)).toEqual([
      'initialize',
      'currentEntry',
      'credentialStatus',
    ]);
  });

  it('未初始化時查詢明確回 503，不隱式初始化', async () => {
    for (const query of [auth.currentEntry, auth.credentialStatus]) {
      await expect(query()).rejects.toMatchObject({
        code: AppErrorCode.AUTH_SUPER_USER_UNAVAILABLE,
        status: 503,
      });
    }
    expect(await snapshot()).toEqual({ access: [], events: [] });
  });

  it('首次初始化建立唯一入口、兩個第 1 版與最近已到期週期，並寫入操作者事件', async () => {
    expect(await auth.initialize()).toEqual({ initialized: true });

    const [row, ...rest] = await accessRows();
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      id: 1,
      entry_generation: 1,
      credential_generation: 1,
      active_credential_fingerprint: app.get(SuperUserConfigService)
        .fingerprint,
      period_start_at: latestDueRotationPeriod(row.rotated_at),
      credential_activated_at: row.rotated_at,
    });
    expect(row.entry_key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(row.entry_key, 'base64url')).toHaveLength(32);

    const event = {
      actor_kind: 'operator',
      actor_user_id: null,
      session_id: null,
      outcome_code: 'succeeded',
      request_id: null,
    };
    expect(await operatorEvents()).toEqual([
      {
        ...event,
        event_type: 'entry.initialized',
        entry_generation: 1,
        credential_generation: null,
      },
      {
        ...event,
        event_type: 'credentials.activated',
        entry_generation: null,
        credential_generation: 1,
      },
    ]);
  });

  it('重複初始化不覆寫既有入口或帳密版本', async () => {
    await auth.initialize();
    await db.query(
      'UPDATE super_user_access SET active_credential_fingerprint = ?, credential_generation = 2',
      ['0'.repeat(64)],
    );
    const before = await snapshot();

    expect(await auth.initialize()).toEqual({ initialized: false });
    expect(await snapshot()).toEqual(before);
  });

  it('並發初始化以 singleton PK 仲裁，只留下一組初始狀態', async () => {
    const real = new SuperUserAccessRepository();
    // 測試連線池上限為 2（.env.test），兩個交易同時持有連線並在 INSERT 前會合。
    const callers = 2;
    let arrived = 0;
    let release!: () => void;
    const allArrived = new Promise<void>((resolve) => (release = resolve));
    jest
      .spyOn(app.get(SuperUserAccessRepository), 'insertIfAbsent')
      .mockImplementation(async (fields, manager) => {
        if (++arrived === callers) release();
        await allArrived;
        return real.insertIfAbsent(fields, manager);
      });

    const results = await Promise.all(
      Array.from({ length: callers }, () => auth.initialize()),
    );

    expect(results.filter((result) => result.initialized)).toHaveLength(1);
    expect(await accessRows()).toHaveLength(1);
    expect(await operatorEvents()).toHaveLength(2);
  });

  it('入口與事件同交易：事件寫入失敗時整筆 rollback', async () => {
    const real = new AuthSecurityEventRepository();
    jest
      .spyOn(app.get(AuthSecurityEventRepository), 'append')
      .mockImplementationOnce((event, manager) => real.append(event, manager))
      .mockRejectedValueOnce(new Error('合成事件寫入失敗'));

    await expect(auth.initialize()).rejects.toThrow('合成事件寫入失敗');
    expect(await snapshot()).toEqual({ access: [], events: [] });
  });

  it('只有 currentEntry 回傳入口路徑與時程；查詢不寫入', async () => {
    await auth.initialize();
    const before = await snapshot();
    const [row] = before.access;

    expect(await auth.currentEntry()).toEqual({
      path: `/ops-access/${row.entry_key}`,
      entryGeneration: 1,
      rotatedAt: row.rotated_at,
      nextScheduledAt: nextRotationPeriod(row.period_start_at),
    });
    expect(await auth.credentialStatus()).toEqual({
      generation: 1,
      localConfigMatches: true,
      activatedAt: row.credential_activated_at,
    });
    expect(await snapshot()).toEqual(before);
  });

  it('credentialStatus 能診斷本機設定與 DB 已啟用版本不符', async () => {
    await auth.initialize();
    await db.query(
      'UPDATE super_user_access SET active_credential_fingerprint = ?',
      ['0'.repeat(64)],
    );

    expect(await auth.credentialStatus()).toMatchObject({
      localConfigMatches: false,
    });
  });

  it('結束時關閉 DB 連線池', async () => {
    const other = await NestFactory.createApplicationContext(ConsoleModule, {
      logger: false,
    });
    const pool = other.get<DataSource>(MYSQL_MAIN);
    expect(pool.isInitialized).toBe(true);

    await other.close();
    expect(pool.isInitialized).toBe(false);
  });
});
