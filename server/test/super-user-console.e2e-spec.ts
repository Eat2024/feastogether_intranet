import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { ModulesContainer, NestFactory } from '@nestjs/core';
import type { DataSource } from 'typeorm';
import { AppModule } from '#app/app.module';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import type { AppException } from '#app/common/errors/app.exception';
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
import { SuperUserAccessWorkerModule } from '#app/worker/auth/super-user-access-worker.module';

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
      SuperUserAccessWorkerModule,
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

  it('REPL 只拿到受控 auth helpers，沒有任意強制輪換或 token 查詢', () => {
    expect(Object.keys(auth)).toEqual([
      'initialize',
      'currentEntry',
      'credentialStatus',
      'rotateEntryIfDue',
      'securityEvents',
      'activateCredentials',
      'hashPassword',
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

  it('未初始化時到期輪換回明確結果，不偷建入口或帳密版本', async () => {
    expect(await auth.rotateEntryIfDue()).toEqual({ status: 'uninitialized' });
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

  it('rotateEntryIfDue 未到期 no-op；到期才以 operator 身分輪換一次，帳密版本不變', async () => {
    await auth.initialize();
    const initial = await snapshot();
    expect(await auth.rotateEntryIfDue()).toEqual({ status: 'not_due' });
    expect(await snapshot()).toEqual(initial);

    const [row] = initial.access;
    await db.query(
      'UPDATE super_user_access SET period_start_at = ? WHERE id = 1',
      [new Date(row.period_start_at.getTime() - 7 * 86_400_000)],
    );
    expect(await auth.rotateEntryIfDue()).toEqual({
      status: 'rotated',
      entryGeneration: 2,
    });
    expect(await auth.rotateEntryIfDue()).toEqual({ status: 'not_due' });

    const [rotated] = await accessRows();
    expect(rotated.entry_key).not.toBe(row.entry_key);
    expect(rotated).toMatchObject({
      entry_generation: 2,
      period_start_at: row.period_start_at,
      credential_generation: row.credential_generation,
      active_credential_fingerprint: row.active_credential_fingerprint,
      credential_activated_at: row.credential_activated_at,
    });
    expect((await operatorEvents()).slice(2)).toEqual([
      {
        event_type: 'entry.rotated',
        actor_kind: 'operator',
        actor_user_id: null,
        session_id: null,
        outcome_code: 'succeeded',
        credential_generation: null,
        entry_generation: 2,
        request_id: null,
      },
    ]);
  });

  it('securityEvents 預設 20 筆、最多 100 筆，beforeId 倒序翻頁；只回白名單欄位且不寫入', async () => {
    await auth.initialize();
    for (let i = 0; i < 23; i++) {
      await db.query(
        `INSERT INTO auth_security_events (event_type, actor_kind, outcome_code, entry_generation, occurred_at)
          VALUES ('entry.rotated', 'operator', 'succeeded', ?, NOW(6))`,
        [i + 2],
      );
    }
    const ids = (
      await db.query<Array<{ id: number }>>(
        "SELECT id FROM auth_security_events WHERE actor_kind = 'operator' ORDER BY id DESC",
      )
    ).map((row) => Number(row.id));
    expect(ids).toHaveLength(25);
    const before = await snapshot();

    const first = await auth.securityEvents();
    expect(first.map((event) => Number(event.id))).toEqual(ids.slice(0, 20));
    const next = await auth.securityEvents({
      limit: 3,
      beforeId: first[first.length - 1].id,
    });
    expect(next.map((event) => Number(event.id))).toEqual(ids.slice(20, 23));
    const all = await auth.securityEvents({ limit: 100 });
    expect(all.map((event) => Number(event.id))).toEqual(
      expect.arrayContaining(ids),
    );
    for (const limit of [0, 101]) {
      await expect(auth.securityEvents({ limit })).rejects.toThrow(RangeError);
    }

    const [{ entry_key }] = before.access;
    for (const event of all) {
      const fields = Object.entries(event)
        .filter(([, value]) => value !== undefined)
        .map(([key]) => key);
      expect(fields.sort()).toEqual(
        [
          'id',
          'eventType',
          'actorKind',
          'actorUserId',
          'sessionId',
          'outcomeCode',
          'credentialGeneration',
          'entryGeneration',
          'requestId',
          'occurredAt',
          'createdAt',
        ].sort(),
      );
      expect(JSON.stringify(event)).not.toContain(entry_key);
    }
    expect(await snapshot()).toEqual(before);
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

  describe('真正的 REPL 程序（pnpm repl:dev）', () => {
    it('兩個 REPL 同時初始化只成功一次、重複不覆寫；入口只出現在 currentEntry 結果，.exit 後關閉連線結束', async () => {
      const repls = [startRepl(), startRepl()];
      try {
        await Promise.all(repls.map((repl) => repl.ready()));

        const results = await Promise.all(
          repls.map((repl) => repl.run('auth.initialize()')),
        );
        expect(results.map((result) => result.initialized).sort()).toEqual([
          false,
          true,
        ]);
        const initialized = await snapshot();
        expect(initialized.access).toHaveLength(1);
        expect(initialized.events).toHaveLength(2);

        const [first] = repls;
        expect(await first.run('auth.initialize()')).toEqual({
          initialized: false,
        });
        expect(await first.run('auth.rotateEntryIfDue()')).toEqual({
          status: 'not_due',
        });
        expect(await first.run('auth.credentialStatus()')).toMatchObject({
          generation: 1,
          localConfigMatches: true,
        });
        expect(await snapshot()).toEqual(initialized);

        const [{ entry_key }] = initialized.access;
        expect(repls.some((repl) => repl.output.includes(entry_key))).toBe(
          false,
        );
        expect(await first.run('auth.currentEntry()')).toMatchObject({
          path: `/ops-access/${entry_key}`,
        });

        expect(await Promise.all(repls.map((repl) => repl.exit()))).toEqual([
          0, 0,
        ]);
      } finally {
        for (const repl of repls) repl.kill();
      }
    }, 120_000);
  });

  /**
   * 027-07：明確啟用本機帳密設定。測試程序只載入一組設定，因此先把 DB 已啟用指紋改成另一個值，
   * 代表「目前啟用的是別組設定」；跨實例、不同設定的行為由 security-super-user-credentials 驗證。
   */
  describe('activateCredentials', () => {
    const OTHER_FINGERPRINT = '0'.repeat(64);
    let userId: number;

    const sha256 = (value: string) =>
      createHash('sha256').update(value).digest('hex');
    const insertSession = async (
      actor: 'super_user' | 'employee',
      status: 'active' | 'revoked',
    ) => {
      const tokenHash = sha256(randomBytes(32).toString('base64url'));
      const result = await db.query<{ insertId: number }>(
        `INSERT INTO auth_sessions (actor_kind, user_id, source, credential_generation, status,
          source_jti_hash, session_token_hash, assertion_expires_at, verified_at, activated_at,
          expires_at, revoked_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3), NOW(3), NOW(3) + INTERVAL 8 HOUR, ?)`,
        [
          actor,
          actor === 'employee' ? userId : null,
          actor === 'employee' ? 'webview' : 'super_user',
          actor === 'employee' ? null : 1,
          status,
          sha256(randomBytes(32).toString('base64url')),
          tokenHash,
          status === 'revoked' ? new Date(Date.now() - 60_000) : null,
        ],
      );
      return { id: result.insertId, tokenHash };
    };
    const sessionRows = (ids: number[]) =>
      db.query<
        Array<{
          id: number;
          status: string;
          revoked_at: Date | null;
          replacement_session_id: number | null;
        }>
      >(
        'SELECT id, status, revoked_at, replacement_session_id FROM auth_sessions WHERE id IN (?) ORDER BY id',
        [ids],
      );
    /** 已初始化，且 DB 啟用的是另一組設定（第 1 版）。 */
    const initializeWithOtherConfigActive = async () => {
      await auth.initialize();
      await db.query(
        'UPDATE super_user_access SET active_credential_fingerprint = ?',
        [OTHER_FINGERPRINT],
      );
    };

    beforeAll(async () => {
      const result = await db.query<{ insertId: number }>(
        "INSERT INTO users (empid, name) VALUES ('SUC001', '合成員工')",
      );
      userId = result.insertId;
    });

    afterEach(async () => {
      const owned = "actor_kind = 'super_user' OR user_id = ?";
      await db.query(
        `UPDATE auth_sessions SET replacement_session_id = NULL WHERE ${owned}`,
        [userId],
      );
      await db.query(`DELETE FROM auth_sessions WHERE ${owned}`, [userId]);
    });

    afterAll(async () => {
      await db.query("DELETE FROM users WHERE empid = 'SUC001'");
    });

    it('CAS 啟用本機設定：只撤銷 active 維護會話，入口不變，員工會話與已撤銷列不動，事件同交易', async () => {
      await initializeWithOtherConfigActive();
      const [before] = await accessRows();
      const live = [
        await insertSession('super_user', 'active'),
        await insertSession('super_user', 'active'),
      ];
      const revoked = await insertSession('super_user', 'revoked');
      const employee = await insertSession('employee', 'active');
      const [revokedBefore, employeeBefore] = await sessionRows([
        revoked.id,
        employee.id,
      ]);

      expect(await auth.activateCredentials({ expectedGeneration: 1 })).toEqual(
        { activated: true },
      );

      const [after] = await accessRows();
      expect(after).toMatchObject({
        entry_key: before.entry_key,
        entry_generation: before.entry_generation,
        rotated_at: before.rotated_at,
        period_start_at: before.period_start_at,
        active_credential_fingerprint: app.get(SuperUserConfigService)
          .fingerprint,
        credential_generation: 2,
      });
      expect(after.credential_activated_at.getTime()).toBeGreaterThan(
        before.credential_activated_at.getTime(),
      );
      expect(
        (await sessionRows(live.map(({ id }) => id))).map((row) => [
          row.status,
          row.revoked_at instanceof Date,
          row.replacement_session_id,
        ]),
      ).toEqual([
        ['revoked', true, null],
        ['revoked', true, null],
      ]);
      expect(await sessionRows([revoked.id, employee.id])).toEqual([
        revokedBefore,
        employeeBefore,
      ]);
      expect((await operatorEvents()).at(-1)).toEqual({
        event_type: 'credentials.activated',
        actor_kind: 'operator',
        actor_user_id: null,
        session_id: null,
        outcome_code: 'succeeded',
        credential_generation: 2,
        entry_generation: null,
        request_id: null,
      });
      expect(await auth.credentialStatus()).toEqual({
        generation: 2,
        localConfigMatches: true,
        activatedAt: after.credential_activated_at,
      });
    });

    it('並發啟用同一個 expectedGeneration：singleton 鎖讓只有一次生效，另一次回版本衝突', async () => {
      await initializeWithOtherConfigActive();
      const real = new SuperUserAccessRepository();
      // 測試連線池上限為 2（.env.test），兩個交易同時持有連線並在鎖定 singleton 前會合。
      const callers = 2;
      let arrived = 0;
      let release!: () => void;
      const allArrived = new Promise<void>((resolve) => (release = resolve));
      jest
        .spyOn(app.get(SuperUserAccessRepository), 'findForUpdate')
        .mockImplementation(async (manager) => {
          if (++arrived === callers) release();
          await allArrived;
          return real.findForUpdate(manager);
        });

      const outcomes = await Promise.all(
        Array.from({ length: callers }, () =>
          auth
            .activateCredentials({ expectedGeneration: 1 })
            .catch((error: AppException) => error.code),
        ),
      );

      expect(outcomes).toHaveLength(callers);
      expect(outcomes).toContainEqual({ activated: true });
      expect(outcomes).toContain(
        AppErrorCode.AUTH_SUPER_USER_GENERATION_CONFLICT,
      );
      expect((await accessRows())[0].credential_generation).toBe(2);
      expect(
        (await operatorEvents()).filter(
          (event) => event.event_type === 'credentials.activated',
        ),
      ).toHaveLength(2);
    });

    it('事件寫入失敗時整筆 rollback：版本、指紋與維護會話都不變', async () => {
      await initializeWithOtherConfigActive();
      const live = await insertSession('super_user', 'active');
      const before = {
        ...(await snapshot()),
        sessions: await sessionRows([live.id]),
      };
      jest
        .spyOn(app.get(AuthSecurityEventRepository), 'append')
        .mockRejectedValueOnce(new Error('合成事件寫入失敗'));

      await expect(
        auth.activateCredentials({ expectedGeneration: 1 }),
      ).rejects.toThrow('合成事件寫入失敗');
      expect({
        ...(await snapshot()),
        sessions: await sessionRows([live.id]),
      }).toEqual(before);
    });

    it('與「Super user → 員工」身分切換交錯時不 deadlock：切換先撤的會話不重複撤銷', async () => {
      await initializeWithOtherConfigActive();
      const live = await insertSession('super_user', 'active');
      // 依 SessionService.replace 的員工目標交易：READ COMMITTED、不鎖 singleton，先鎖舊會話，再插入新員工會話並撤舊。
      // 登出（SessionService.revoke）同樣是先鎖會話再改 status，等待關係相同。
      const runner = db.createQueryRunner();
      await runner.connect();
      let pending: Promise<unknown> | undefined;
      try {
        await runner.startTransaction('READ COMMITTED');
        await runner.query(
          'SELECT id FROM auth_sessions WHERE session_token_hash = ? FOR UPDATE',
          [live.tokenHash],
        );
        pending = auth.activateCredentials({ expectedGeneration: 1 });
        // 以真 MySQL 鎖等待作同步點：啟用交易已鎖 singleton，正等待這筆維護會話。
        let waiting = false;
        for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
          const [{ count }] = (await runner.query(
            "SELECT COUNT(*) AS count FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON w.REQUESTING_ENGINE_LOCK_ID=l.ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA=DATABASE() AND l.OBJECT_NAME='auth_sessions'",
          )) as Array<{ count: string }>;
          waiting = Number(count) > 0;
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        const created = (await runner.query(
          `INSERT INTO auth_sessions (actor_kind, user_id, source, status, source_jti_hash,
            session_token_hash, assertion_expires_at, verified_at, activated_at, expires_at)
            VALUES ('employee', ?, 'webview', 'active', ?, ?, NOW(3), NOW(3), NOW(3), NOW(3) + INTERVAL 8 HOUR)`,
          [
            userId,
            sha256(randomBytes(32).toString('base64url')),
            sha256(randomBytes(32).toString('base64url')),
          ],
        )) as { insertId: number };
        const switchedAt = new Date(Date.now() - 1000);
        await runner.query(
          "UPDATE auth_sessions SET status = 'revoked', revoked_at = ?, replacement_session_id = ? WHERE id = ?",
          [switchedAt, created.insertId, live.id],
        );
        await runner.commitTransaction();

        await expect(pending).resolves.toEqual({ activated: true });
        expect(await sessionRows([live.id, created.insertId])).toEqual([
          {
            id: live.id,
            status: 'revoked',
            revoked_at: switchedAt,
            replacement_session_id: created.insertId,
          },
          {
            id: created.insertId,
            status: 'active',
            revoked_at: null,
            replacement_session_id: null,
          },
        ]);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await pending?.catch(() => undefined);
        await runner.release();
      }
    });
  });
});

const SERVER_ROOT = join(__dirname, '..');

/**
 * 以 package.json 的 `repl:dev` 啟動真正的 REPL 程序，環境變數沿用 .env.test（程序環境優先於 server/.env）。
 * stdin 不是 TTY，REPL 不回顯輸入；每個指令以唯一標記印出 JSON 結果再解析。
 */
function startRepl() {
  const child = spawn('pnpm', ['-s', 'repl:dev'], {
    cwd: SERVER_ROOT,
    env: process.env,
    stdio: 'pipe',
  });
  let output = '';
  let sequence = 0;
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    output += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    output += chunk;
  });
  const waitForOutput = async (pattern: RegExp, timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const match = pattern.exec(output);
      if (match) return match;
      if (child.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`REPL 沒有輸出預期結果：${output}`);
  };
  return {
    get output() {
      return output;
    },
    ready: () => waitForOutput(/> $/m),
    async run(expression: string): Promise<Record<string, unknown>> {
      const marker = `@@result-${++sequence}@@`;
      child.stdin.write(
        `console.log('${marker}' + JSON.stringify(await ${expression}))\n`,
      );
      const match = await waitForOutput(new RegExp(`${marker}(.*)\n`));
      return JSON.parse(match[1]) as Record<string, unknown>;
    },
    async exit(): Promise<number | null> {
      const exited = once(child, 'exit');
      child.stdin.write('.exit\n');
      const [code] = (await exited) as [number | null];
      return code;
    },
    kill: () => {
      if (child.exitCode === null) child.kill();
    },
  };
}
