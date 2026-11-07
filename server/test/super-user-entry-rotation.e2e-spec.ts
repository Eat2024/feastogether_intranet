import { seedAuthorizationCatalog } from './helpers/authorization-fixtures';
import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplicationContext } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import {
  latestDueRotationPeriod,
  nextRotationPeriod,
} from '#app/features/auth/helpers/rotation-period';
import { AuthSessionRepository } from '#app/features/auth/repositories/auth-session.repository';
import { SuperUserAccessRepository } from '#app/features/auth/repositories/super-user-access.repository';
import { SuperUserAccessService } from '#app/features/auth/services/super-user-access.service';
import { SuperUserConfigService } from '#app/features/auth/services/super-user-config.service';
import { PortalUserSyncService } from '#app/features/users/services/portal-user-sync.service';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { WorkerModule } from '#app/worker.module';
import {
  AUTH_ACCESS_MAINTENANCE_QUEUE,
  SUPER_USER_ENTRY_ROTATION_JOB,
} from '#app/worker/auth/super-user-access.constants';
import { SuperUserAccessProcessor } from '#app/worker/auth/super-user-access.processor';
import { SuperUserAccessScheduler } from '#app/worker/auth/super-user-access.scheduler';
import { SuperUserAccessWorkerModule } from '#app/worker/auth/super-user-access-worker.module';
import {
  closeSecurityE2eApp,
  createSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

/** setup-e2e.ts 以合成值覆寫的 Super user 帳密。 */
const ACCOUNT = 'e2e-super-user';
const PASSWORD = 'e2e-synthetic-super-user-password';
const ORIGIN = 'http://localhost:3000';
const WEEK = 7 * 86_400_000;
const HOUR = 3_600_000;
const SCHEDULER_ID = 'super-user-entry-weekly';
const SYSTEM = { kind: 'system' } as const;
const newIp = () =>
  `198.19.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;

interface AccessRow {
  entry_key: string;
  entry_generation: number;
  period_start_at: Date;
  credential_generation: number;
  active_credential_fingerprint: string;
}

/**
 * US3：DB 週期仲裁每週輪換。worker 用正式 WorkerModule 連測試 Redis／MySQL（Portal 匯入換成替身，不連 Portal）；
 * HTTP 用正式 AppModule 驗證舊入口失效與會話不受影響。停機以「DB 已處理週期落後」模擬，不改系統時間。
 */
describe('Super user 維護入口每週輪換（027-06）', () => {
  let ctx: SecurityE2eContext;
  let db: DataSource;
  let queue: Queue;
  let access: SuperUserAccessService;
  let workers: INestApplicationContext[] = [];

  const accessRow = async () =>
    (
      await db.query<AccessRow[]>(
        `SELECT entry_key, entry_generation, period_start_at, credential_generation,
          active_credential_fingerprint FROM super_user_access`,
      )
    )[0];
  const rotationEvents = () =>
    db.query<Array<Record<string, unknown>>>(
      `SELECT actor_kind, outcome_code, entry_generation, credential_generation, session_id
        FROM auth_security_events WHERE event_type = 'entry.rotated' ORDER BY id`,
    );
  /** 模擬停機：把 DB 已處理週期往前推 weeks 週，入口與版本不動。 */
  const missWeeks = (weeks: number) =>
    db.query('UPDATE super_user_access SET period_start_at = ? WHERE id = 1', [
      new Date(latestDueRotationPeriod(new Date()).getTime() - weeks * WEEK),
    ]);
  const getEntry = (key: string) =>
    request(ctx.server).get(`/api/auth/super-user-entries/${key}`);
  const login = (key: string) =>
    request(ctx.server)
      .post(`/api/auth/super-user-entries/${key}/sessions`)
      .set('X-Forwarded-For', newIp())
      .set('Origin', ORIGIN)
      .send({ account: ACCOUNT, password: PASSWORD });
  const tokenFrom = (response: request.Response) =>
    /^[^=]+=([^;]*)/.exec(
      ([] as string[])
        .concat(response.headers['set-cookie'] ?? [])
        .find((value) => value.startsWith(`${AUTH_COOKIE_NAME}=`))!,
    )![1];
  const getSession = (token: string) =>
    request(ctx.server)
      .get('/api/auth/session')
      .set('Cookie', `${AUTH_COOKIE_NAME}=${token}`);

  async function startWorker(): Promise<INestApplicationContext> {
    await seedAuthorizationCatalog(db);
    const worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(PortalUserSyncService)
      .useValue({ run: jest.fn() })
      .compile();
    await worker.init();
    workers.push(worker);
    return worker;
  }

  async function stopWorkers(): Promise<void> {
    await Promise.all(workers.map((worker) => worker.close()));
    workers = [];
  }

  beforeAll(async () => {
    if (process.env.NODE_ENV !== 'test' || process.env.REDIS_DB === '0') {
      throw new Error('queue e2e 只允許使用隔離的 test Redis DB');
    }
    queue = new Queue(AUTH_ACCESS_MAINTENANCE_QUEUE, {
      connection: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT),
        password: process.env.REDIS_PASSWORD || undefined,
        db: Number(process.env.REDIS_DB),
      },
    });
    await queue.obliterate({ force: true });
    ctx = await createSecurityE2eApp(undefined, null);
    db = ctx.app.get<DataSource>(MYSQL_MAIN);
    access = ctx.app.get(SuperUserAccessService, { strict: false });
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await access.initialize();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await stopWorkers();
    await db.query(
      "DELETE FROM auth_security_events WHERE actor_kind IN ('operator', 'system', 'super_user', 'anonymous')",
    );
    await db.query(
      "UPDATE auth_sessions SET replacement_session_id = NULL WHERE actor_kind = 'super_user'",
    );
    await db.query("DELETE FROM auth_sessions WHERE actor_kind = 'super_user'");
    await db.query('DELETE FROM super_user_access');
  });

  afterAll(async () => {
    await queue?.obliterate({ force: true });
    await queue?.close();
    if (ctx) await closeSecurityE2eApp(ctx);
  });

  describe('worker 排程與停機補做', () => {
    it('HTTP app 不註冊維護 queue、排程或 processor，也不在 Redis 建立排程', async () => {
      const loaded = new Set(
        [...ctx.app.get(ModulesContainer).values()].map(
          (moduleRef) => moduleRef.metatype,
        ),
      );
      expect(loaded.has(SuperUserAccessWorkerModule)).toBe(false);
      for (const token of [
        SuperUserAccessScheduler,
        SuperUserAccessProcessor,
        getQueueToken(AUTH_ACCESS_MAINTENANCE_QUEUE),
      ]) {
        expect(() => ctx.app.get(token, { strict: false })).toThrow();
      }
      expect(await queue.getJobSchedulers()).toEqual([]);
    });

    it('停機多週後兩個 worker 同時啟動：DB 只補一次，Redis 只有一個每週一台北 04:00 排程', async () => {
      await missWeeks(3);
      const before = await accessRow();

      await Promise.all([startWorker(), startWorker()]);

      const after = await accessRow();
      expect(after.entry_key).not.toBe(before.entry_key);
      expect(after).toMatchObject({
        entry_generation: 2,
        period_start_at: latestDueRotationPeriod(new Date()),
        credential_generation: before.credential_generation,
        active_credential_fingerprint: before.active_credential_fingerprint,
      });
      expect(await rotationEvents()).toEqual([
        {
          actor_kind: 'system',
          outcome_code: 'succeeded',
          entry_generation: 2,
          credential_generation: null,
          session_id: null,
        },
      ]);

      expect(await queue.getJobSchedulers()).toEqual([
        expect.objectContaining({
          key: SCHEDULER_ID,
          name: SUPER_USER_ENTRY_ROTATION_JOB,
          pattern: '0 4 * * 1',
          tz: 'Asia/Taipei',
          next: nextRotationPeriod(
            latestDueRotationPeriod(new Date()),
          ).getTime(),
          // BullMQ 不保存空的 template data。
          template: {
            opts: {
              attempts: 3,
              backoff: { type: 'exponential', delay: 5_000 },
              removeOnComplete: 100,
              removeOnFail: 100,
            },
          },
        }),
      ]);
      expect(await queue.getJobCounts('wait', 'delayed', 'active')).toEqual({
        wait: 0,
        delayed: 1,
        active: 0,
      });
    });

    it('同週重啟不換入口；Redis 排程遺失後重啟，仍依 DB 週期補做並重建排程', async () => {
      const initial = await accessRow();
      await startWorker();
      await stopWorkers();
      await startWorker();
      await stopWorkers();
      expect(await accessRow()).toEqual(initial);
      expect(await rotationEvents()).toEqual([]);

      await queue.obliterate({ force: true });
      await missWeeks(1);
      await startWorker();

      expect(await accessRow()).toMatchObject({ entry_generation: 2 });
      expect(await rotationEvents()).toHaveLength(1);
      expect(await queue.getJobSchedulers()).toEqual([
        expect.objectContaining({ key: SCHEDULER_ID, pattern: '0 4 * * 1' }),
      ]);
    });

    it('錯過的那一次 job 仍在 Redis：啟動補做與該 job 由 DB 週期仲裁，只換一次', async () => {
      await missWeeks(1);
      // 模擬上週一 04:00 前有 worker 註冊排程，之後停機到本週一 04:00 以後。
      const missed = latestDueRotationPeriod(new Date()).getTime();
      const clock = jest.spyOn(Date, 'now').mockReturnValue(missed - HOUR);
      try {
        await new SuperUserAccessScheduler(queue, {
          process: () => Promise.resolve({ status: 'not_due' }),
        } as never).onModuleInit();
      } finally {
        clock.mockRestore();
      }
      expect(await queue.getJobScheduler(SCHEDULER_ID)).toMatchObject({
        next: missed,
      });

      await startWorker();
      await waitFor(async () => (await queue.getCompletedCount()) === 1);

      const [job] = await queue.getCompleted();
      expect(['rotated', 'not_due']).toContain(
        (job.returnvalue as { status: string }).status,
      );
      expect(await accessRow()).toMatchObject({ entry_generation: 2 });
      expect(await rotationEvents()).toHaveLength(1);
      expect(await queue.getJobScheduler(SCHEDULER_ID)).toMatchObject({
        next: nextRotationPeriod(new Date(missed)).getTime(),
      });
    });

    it('job 第一次 DB 寫入失敗保留舊入口並記白名單原因，重試後只換一次', async () => {
      const worker = await startWorker();
      const before = await accessRow();
      expect(before.entry_generation).toBe(1);
      await missWeeks(1);
      const repository = worker.get(SuperUserAccessRepository, {
        strict: false,
      });
      const save = jest.spyOn(repository, 'save').mockRejectedValueOnce(
        Object.assign(new Error(`synthetic failure ${'x'.repeat(8)}`), {
          code: 'ER_LOCK_WAIT_TIMEOUT',
        }),
      );

      const [scheduled] = await queue.getDelayed();
      await scheduled.promote();
      await waitFor(
        async () => (await queue.getJob(scheduled.id!))?.attemptsMade === 1,
      );
      const retrying = (await queue.getJob(scheduled.id!))!;
      expect(retrying.failedReason).toBe(
        '維護入口輪換失敗（ER_LOCK_WAIT_TIMEOUT）',
      );
      expect(JSON.stringify(retrying.stacktrace)).not.toContain('synthetic');
      expect(await accessRow()).toMatchObject({
        entry_key: before.entry_key,
        entry_generation: 1,
      });
      await getEntry(before.entry_key).expect(200);

      // exponential backoff 初始 5000ms 後重試。
      await waitFor(
        async () =>
          (await queue.getJob(scheduled.id!))?.finishedOn !== undefined,
        15_000,
      );
      const finished = (await queue.getJob(scheduled.id!))!;
      expect(finished).toMatchObject({
        attemptsMade: 2,
        returnvalue: { status: 'rotated', entryGeneration: 2 },
      });
      expect(save).toHaveBeenCalledTimes(2);
      expect(await accessRow()).toMatchObject({ entry_generation: 2 });
      expect(await rotationEvents()).toHaveLength(1);
      await getEntry(before.entry_key).expect(404);
    }, 30_000);

    it('未初始化：worker 照常啟動，啟動補做與 job 都回明確結果，不建立入口', async () => {
      await db.query(
        "DELETE FROM auth_security_events WHERE actor_kind = 'operator'",
      );
      await db.query('DELETE FROM super_user_access');

      await startWorker();
      const [scheduled] = await queue.getDelayed();
      await scheduled.promote();
      await waitFor(async () => (await queue.getCompletedCount()) === 1);

      const [job] = await queue.getCompleted();
      expect(job.returnvalue).toEqual({ status: 'uninitialized' });
      expect(await db.query('SELECT id FROM super_user_access')).toEqual([]);
      expect(await rotationEvents()).toEqual([]);
    });
  });

  describe('舊入口失效與會話', () => {
    it('輪換後舊入口 GET／POST 立即 404（含輪換前已開的表單）；新入口可用，既有 Super user 會話仍有效', async () => {
      const old = await accessRow();
      const token = tokenFrom(await login(old.entry_key).expect(201));
      await getEntry(old.entry_key).expect(200);
      await missWeeks(1);

      await expect(access.rotateEntryIfDue(SYSTEM)).resolves.toEqual({
        status: 'rotated',
        entryGeneration: 2,
      });

      const current = await accessRow();
      await getEntry(old.entry_key).expect(404);
      const stale = await login(old.entry_key).expect(404);
      expect(stale.headers['set-cookie']).toBeUndefined();
      await getEntry(current.entry_key).expect(200);
      await getSession(token).expect(200);
      expect(current.credential_generation).toBe(old.credential_generation);
    });

    it('多個執行者同時輪換同一週期，只有一次有效輪換', async () => {
      await missWeeks(2);

      const results = await Promise.all([
        access.rotateEntryIfDue(SYSTEM),
        access.rotateEntryIfDue({ kind: 'operator' }),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual([
        'not_due',
        'rotated',
      ]);
      expect(await accessRow()).toMatchObject({ entry_generation: 2 });
      expect(await rotationEvents()).toHaveLength(1);
    });

    it('輪換先 commit：KDF 期間的舊入口登入在交易內重驗失敗，不簽發會話', async () => {
      const old = await accessRow();
      await missWeeks(1);
      const config = ctx.app.get(SuperUserConfigService, { strict: false });
      const verify = config.verify.bind(config) as typeof config.verify;
      jest
        .spyOn(config, 'verify')
        .mockImplementationOnce(async (account, password) => {
          const matched = await verify(account, password);
          await access.rotateEntryIfDue(SYSTEM);
          return matched;
        });

      const response = await login(old.entry_key).expect(404);

      expect(response.headers['set-cookie']).toBeUndefined();
      expect(await accessRow()).toMatchObject({ entry_generation: 2 });
      expect(
        await db.query(
          "SELECT id FROM auth_sessions WHERE actor_kind = 'super_user'",
        ),
      ).toEqual([]);
    });

    it('登入先鎖定並 commit：輪換等待 singleton 鎖，之後才換入口，該會話仍有效', async () => {
      const old = await accessRow();
      await missWeeks(1);
      const sessions = ctx.app.get(AuthSessionRepository, { strict: false });
      const createActive = sessions.createActive.bind(
        sessions,
      ) as typeof sessions.createActive;
      let rotation!: ReturnType<SuperUserAccessService['rotateEntryIfDue']>;
      let rotatedBeforeLoginCommit = false;
      jest
        .spyOn(sessions, 'createActive')
        .mockImplementationOnce(async (fields, manager) => {
          // 登入交易已鎖 singleton；另一條連線的輪換只能等它 commit。
          rotation = access.rotateEntryIfDue(SYSTEM);
          void rotation.then(() => (rotatedBeforeLoginCommit = true));
          await new Promise((resolve) => setTimeout(resolve, 300));
          expect(rotatedBeforeLoginCommit).toBe(false);
          return createActive(fields, manager);
        });

      const token = tokenFrom(await login(old.entry_key).expect(201));

      await expect(rotation).resolves.toEqual({
        status: 'rotated',
        entryGeneration: 2,
      });
      await getSession(token).expect(200);
      await getEntry(old.entry_key).expect(404);
    });
  });
});

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('等待 queue 狀態逾時');
}
