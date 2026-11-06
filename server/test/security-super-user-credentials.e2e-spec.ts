import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import request, { type Response } from 'supertest';
import { DataSource } from 'typeorm';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import {
  hashSuperUserPassword,
  superUserCredentialFingerprint,
} from '#app/features/auth/helpers/super-user-password';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';
import { apiData, apiError, type InsertResult } from './api-response.helper';

// 每個實例與 REPL 都是真正的 Node 子程序（ts-node 啟動約 2 秒），整段旅程需要較長時間。
jest.setTimeout(120_000);

const SERVER_ROOT = join(__dirname, '..');
const NODE_ARGS = ['--conditions=development', '-r', 'ts-node/register'];
/** 共用測試 DB／Redis 的兩個 HTTP 實例；port 由本 worktree 專用。 */
const PORT_A = 3030;
const PORT_B = 3031;
const ORIGIN = 'http://localhost:3000';

interface SuperUserConfig {
  account: string;
  password: string;
  passwordHash: string;
}

interface Instance {
  port: number;
  config: SuperUserConfig;
  child: ChildProcess;
  output: string[];
}

type ConsoleOutcome =
  | { result: unknown }
  | { error: { code: string; status: number } };

/** 舊設定沿用 setup-e2e.ts 的合成帳密；新設定在 beforeAll 以新 salt 產生（只換密碼）。 */
const OLD: SuperUserConfig = {
  account: 'e2e-super-user',
  password: 'e2e-synthetic-super-user-password',
  passwordHash: process.env.SUPER_USER_PASSWORD_HASH!,
};
const NEW_PASSWORD = 'e2e-synthetic-next-super-user-password';

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// 限流計數存 Redis 且跨回合存活；每次登入用不同 client IP，避免互相消耗額度。
const newIp = () =>
  `198.18.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
const fingerprintOf = (config: SuperUserConfig) =>
  superUserCredentialFingerprint(config.account, config.passwordHash);
/** 子程序沿用本測試的隔離 DB／Redis 環境，只換 Super user 設定。 */
const envFor = (config: SuperUserConfig) => ({
  ...process.env,
  SUPER_USER_ACCOUNT: config.account,
  SUPER_USER_PASSWORD_HASH: config.passwordHash,
});
const baseUrl = (instance: Instance) => `http://127.0.0.1:${instance.port}`;

/** 殘留程序會讓請求打到錯的實例，所以先確認 port 沒人使用。 */
function assertPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(port, '0.0.0.0', () => probe.close(() => resolve()));
  });
}

/** 以正式入口 src/main.ts 啟動一個 HTTP 實例，等到回應 401 才算就緒。 */
async function startInstance(
  port: number,
  config: SuperUserConfig,
): Promise<Instance> {
  await assertPortFree(port);
  const child = spawn(process.execPath, [...NODE_ARGS, 'src/main.ts'], {
    cwd: SERVER_ROOT,
    env: { ...envFor(config), PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const instance = { port, config, child, output: [] as string[] };
  child.stdout.on('data', (chunk) => instance.output.push(String(chunk)));
  child.stderr.on('data', (chunk) => instance.output.push(String(chunk)));
  for (let attempt = 0; attempt < 120 && child.exitCode === null; attempt++) {
    const status = await request(baseUrl(instance))
      .get('/api/auth/session')
      .then(
        (response) => response.status,
        () => null,
      );
    if (status === 401) return instance;
    await sleep(250);
  }
  await stopInstance(instance);
  throw new Error(
    `測試實例 :${port} 未就緒\n${instance.output.join('').slice(-2000)}`,
  );
}

async function stopInstance(instance: Instance): Promise<void> {
  const { child } = instance;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await exited;
}

/** 相同設定單純重啟。 */
async function restart(instance: Instance): Promise<Instance> {
  await stopInstance(instance);
  return startInstance(instance.port, instance.config);
}

/** 載入指定設定的獨立 REPL 程序執行一個 auth helper。 */
async function runConsole(
  config: SuperUserConfig,
  helper: string,
  input?: unknown,
): Promise<ConsoleOutcome> {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      ...NODE_ARGS,
      'test/helpers/run-auth-console.ts',
      helper,
      ...(input === undefined ? [] : [JSON.stringify(input)]),
    ],
    { cwd: SERVER_ROOT, env: envFor(config) },
  );
  return JSON.parse(stdout.trim().split('\n').at(-1)!) as ConsoleOutcome;
}

/**
 * US4：兩個共用 DB／Redis、載入不同 Super user 設定的真實 HTTP 程序，加上分別載入兩組設定的 REPL 程序。
 * 驗證明確啟用的生效點、混跑期間的 503、跨實例撤銷，以及員工會話不受影響。步驟依序相依。
 */
describe('Super user 帳密啟用與跨實例撤銷 (027-07)', () => {
  let db: DataSource;
  let NEW: SuperUserConfig;
  let a: Instance;
  let b: Instance;
  let entryKey: string;
  let userId: number;
  let employeeToken: string;
  /** 舊設定在第 1 版登入的維護會話；之後所有步驟都不得讓它復活。 */
  let firstToken: string;
  /** 新設定在第 2 版登入的維護會話。 */
  let secondToken: string;

  const login = (instance: Instance) =>
    request(baseUrl(instance))
      .post(`/api/auth/super-user-entries/${entryKey}/sessions`)
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', newIp())
      .send({
        account: instance.config.account,
        password: instance.config.password,
      });
  const tokenFrom = (response: Response) =>
    ([] as string[])
      .concat(response.headers['set-cookie'] ?? [])
      .map((cookie) => new RegExp(`^${AUTH_COOKIE_NAME}=([^;]*)`).exec(cookie))
      .find(Boolean)![1];
  const sessionOn = (instance: Instance, token: string) =>
    request(baseUrl(instance))
      .get('/api/auth/session')
      .set('Cookie', `${AUTH_COOKIE_NAME}=${token}`);
  const expectActor = async (
    instance: Instance,
    token: string,
    kind: 'employee' | 'super_user',
  ) => {
    const response = await sessionOn(instance, token).expect(200);
    expect(apiData<{ actor: { kind: string } }>(response).actor.kind).toBe(
      kind,
    );
  };
  const expectError = async (
    pending: request.Test,
    status: number,
    code: string,
  ) => {
    const response = await pending.expect(status);
    expect(apiError(response).code).toBe(code);
  };
  /** 會話已失效：回 401，前端走一般重新登入。 */
  const expectSessionInvalid = (instance: Instance, token: string) =>
    expectError(sessionOn(instance, token), 401, AppErrorCode.UNAUTHORIZED);
  /** 本機設定不是 DB 啟用版本：維護身分暫停，回 503。 */
  const expectSuperUserUnavailable = (pending: request.Test) =>
    expectError(pending, 503, AppErrorCode.AUTH_SUPER_USER_UNAVAILABLE);
  const expectEmployeeOnBoth = async () => {
    await expectActor(a, employeeToken, 'employee');
    await expectActor(b, employeeToken, 'employee');
  };
  const activeVersion = async () =>
    (
      await db.query<
        Array<{
          credential_generation: number;
          active_credential_fingerprint: string;
        }>
      >(
        'SELECT credential_generation, active_credential_fingerprint FROM super_user_access',
      )
    )[0];
  const sessionStatus = async (token: string) =>
    (
      await db.query<Array<{ status: string }>>(
        'SELECT status FROM auth_sessions WHERE session_token_hash = ?',
        [sha256(token)],
      )
    )[0].status;

  beforeAll(async () => {
    db = new DataSource(buildMysqlOptions());
    await db.initialize();
    NEW = {
      account: OLD.account,
      password: NEW_PASSWORD,
      passwordHash: await hashSuperUserPassword(NEW_PASSWORD),
    };

    // 維運 REPL（舊設定）首次初始化，舊設定成為第 1 版。
    expect(await runConsole(OLD, 'initialize')).toEqual({
      result: { initialized: true },
    });
    [{ entry_key: entryKey }] = await db.query<Array<{ entry_key: string }>>(
      'SELECT entry_key FROM super_user_access',
    );

    // 既有員工會話（合成）；員工登入流程本身不在本測試範圍。
    const user = await db.query<InsertResult>(
      "INSERT INTO users (empid, name) VALUES ('SUC002', '合成員工')",
    );
    userId = user.insertId;
    employeeToken = randomBytes(32).toString('base64url');
    await db.query(
      `INSERT INTO auth_sessions (actor_kind, user_id, source, status, source_jti_hash,
        session_token_hash, assertion_expires_at, verified_at, activated_at, expires_at)
        VALUES ('employee', ?, 'webview', 'active', ?, ?, NOW(3), NOW(3), NOW(3), NOW(3) + INTERVAL 8 HOUR)`,
      [
        userId,
        sha256(randomBytes(32).toString('base64url')),
        sha256(employeeToken),
      ],
    );

    [a, b] = await Promise.all([
      startInstance(PORT_A, OLD),
      startInstance(PORT_B, NEW),
    ]);
  });

  afterAll(async () => {
    await Promise.all([a, b].filter(Boolean).map(stopInstance));
    if (!db?.isInitialized) return;
    const owned = "s.actor_kind = 'super_user' OR s.user_id = ?";
    await db.query(
      `DELETE e FROM auth_security_events e LEFT JOIN auth_sessions s ON s.id = e.session_id
        WHERE e.actor_kind IN ('super_user', 'operator') OR ${owned}`,
      [userId],
    );
    await db.query(
      `UPDATE auth_sessions s SET s.replacement_session_id = NULL WHERE ${owned}`,
      [userId],
    );
    await db.query(`DELETE s FROM auth_sessions s WHERE ${owned}`, [userId]);
    await db.query("DELETE FROM users WHERE empid = 'SUC002'");
    await db.query('DELETE FROM super_user_access');
    await db.destroy();
  });

  it('未啟用新設定：新設定實例啟動不改寫 DB 版本，維護登入與既有維護會話都回 503；舊設定實例照常，員工兩側有效', async () => {
    expect(await activeVersion()).toEqual({
      credential_generation: 1,
      active_credential_fingerprint: fingerprintOf(OLD),
    });
    const first = await login(a).expect(201);
    firstToken = tokenFrom(first);

    await expectActor(a, firstToken, 'super_user');
    await expectSuperUserUnavailable(sessionOn(b, firstToken));
    await expectSuperUserUnavailable(login(b));
    await expectEmployeeOnBoth();
    // 新設定的 REPL 在啟用前即可診斷本機設定尚未生效。
    expect(await runConsole(NEW, 'credentialStatus')).toMatchObject({
      result: { generation: 1, localConfigMatches: false },
    });
  });

  it('相同設定單純重啟不撤維護會話，也不改 DB 版本', async () => {
    a = await restart(a);

    await expectActor(a, firstToken, 'super_user');
    expect(await activeVersion()).toEqual({
      credential_generation: 1,
      active_credential_fingerprint: fingerprintOf(OLD),
    });
  });

  it('expectedGeneration 不是目前版本時拒絕，不啟用也不撤會話', async () => {
    expect(
      await runConsole(NEW, 'activateCredentials', { expectedGeneration: 2 }),
    ).toEqual({
      error: {
        code: AppErrorCode.AUTH_SUPER_USER_GENERATION_CONFLICT,
        status: 409,
      },
    });

    expect((await activeVersion()).credential_generation).toBe(1);
    await expectActor(a, firstToken, 'super_user');
  });

  it('新設定 REPL 啟用後：舊維護會話兩側拒絕，舊實例不能登入、重啟也不能改回版本；新設定可登入，員工不受影響', async () => {
    expect(
      await runConsole(NEW, 'activateCredentials', { expectedGeneration: 1 }),
    ).toEqual({ result: { activated: true } });
    expect(await activeVersion()).toEqual({
      credential_generation: 2,
      active_credential_fingerprint: fingerprintOf(NEW),
    });
    expect(await sessionStatus(firstToken)).toBe('revoked');

    await expectSessionInvalid(a, firstToken);
    await expectSessionInvalid(b, firstToken);
    await expectSuperUserUnavailable(login(a));
    a = await restart(a);
    expect((await activeVersion()).credential_generation).toBe(2);
    await expectSuperUserUnavailable(login(a));

    const second = await login(b).expect(201);
    secondToken = tokenFrom(second);
    await expectActor(b, secondToken, 'super_user');
    // 舊設定實例仍在混跑：維護操作 503，直到它也換成新設定。
    await expectSuperUserUnavailable(sessionOn(a, secondToken));
    await expectEmployeeOnBoth();
  });

  it('相同設定再次啟用為 no-op，不撤目前維護會話', async () => {
    expect(
      await runConsole(NEW, 'activateCredentials', { expectedGeneration: 2 }),
    ).toEqual({ result: { activated: false } });

    expect((await activeVersion()).credential_generation).toBe(2);
    await expectActor(b, secondToken, 'super_user');
  });

  it('再啟用舊設定也增加 generation：先前的維護會話都不復活，舊設定實例可重新登入', async () => {
    expect(
      await runConsole(OLD, 'activateCredentials', { expectedGeneration: 2 }),
    ).toEqual({ result: { activated: true } });
    expect(await activeVersion()).toEqual({
      credential_generation: 3,
      active_credential_fingerprint: fingerprintOf(OLD),
    });

    for (const token of [firstToken, secondToken]) {
      await expectSessionInvalid(a, token);
      await expectSessionInvalid(b, token);
    }
    const third = await login(a).expect(201);
    await expectActor(a, tokenFrom(third), 'super_user');
    await expectSuperUserUnavailable(login(b));
    await expectEmployeeOnBoth();

    expect(
      await db.query<Array<{ credential_generation: number }>>(
        "SELECT credential_generation FROM auth_security_events WHERE actor_kind = 'operator' AND event_type = 'credentials.activated' ORDER BY id",
      ),
    ).toEqual([
      { credential_generation: 1 },
      { credential_generation: 2 },
      { credential_generation: 3 },
    ]);
  });
});
