import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import mysql from 'mysql2/promise';
import { DataSource } from 'typeorm';
import { User } from '#app/features/users/entities/user.entity';
import { PortalUserSyncModule } from '#app/features/users/portal-user-sync.module';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import {
  PortalUserSyncError,
  PortalUserSyncService,
} from '#app/features/users/services/portal-user-sync.service';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { createSchemaTestDatabaseName } from '#app/infrastructure/database/test/schema-test-database';
import { InfrastructureModule } from '#app/infrastructure/infrastructure.module';
import {
  AppLoggerService,
  type AppLogInput,
} from '#app/infrastructure/logging/appLog/app-logger.service';
import { RequestIdClsModule } from '#app/infrastructure/logging/requestId/request-id.module';
import { PortalConfig } from '#app/infrastructure/portal/portal.config';
import {
  PORTAL_SENTINEL,
  createSyntheticPortal,
  portalConfigFrom,
  type SyntheticPerson,
  type SyntheticPortal,
} from './synthetic-portal.helper';

// 本檔用獨立的 schema 測試庫（不碰其他 e2e 共用的 users），Portal 是 setup-e2e 指定的合成庫。
const database = createSchemaTestDatabaseName();
const mysqlOptions = () =>
  buildMysqlOptions((key) =>
    key === 'DB_MYSQL_DB' ? database : process.env[key],
  );

function adminConnection() {
  return mysql.createConnection({
    host: process.env.DB_MYSQL_HOST,
    port: Number(process.env.DB_MYSQL_PORT),
    user: process.env.DB_MYSQL_USER,
    password: process.env.DB_MYSQL_PASS,
  });
}

/** 本機 users 的完整快照，時間欄位轉成含微秒的字串。 */
const USERS_SNAPSHOT_SQL = `SELECT id, empid, name, email, person_status, is_active, department_id,
  department_code, department_name, title_name, CAST(last_login_at AS CHAR) last_login_at,
  CAST(created_at AS CHAR) created_at, CAST(updated_at AS CHAR) updated_at,
  CAST(deleted_at AS CHAR) deleted_at FROM users ORDER BY id`;

/** 工作目錄（server/）下的所有檔案，不含 node_modules。 */
async function workingFiles(): Promise<string[]> {
  const entries = await readdir(process.cwd(), {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name))
    .filter((path) => !path.includes('node_modules'))
    .sort();
}

/** 跟 worker／CLI 一樣載入 InfrastructureModule 與匯入模組；主 DB 指向本檔的 schema 測試庫。 */
async function startContext(portalConfig?: PortalConfig) {
  let builder = Test.createTestingModule({
    imports: [RequestIdClsModule, InfrastructureModule, PortalUserSyncModule],
  })
    .overrideProvider(MYSQL_MAIN)
    .useFactory({ factory: () => new DataSource(mysqlOptions()).initialize() });
  if (portalConfig) {
    builder = builder.overrideProvider(PortalConfig).useValue(portalConfig);
  }
  const context = await builder.compile();
  await context.init();
  return context;
}

/**
 * 以子程序執行手動 CLI 原始碼（ts-node），與 UAT 一樣自行建立 Nest context；主 DB 指向本檔的 schema 測試庫。
 * log 等級開到 info，log 與 CLI 輸出都在 stdout，才能檢查 log 中有沒有被略過的員編。
 */
function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(
    process.execPath,
    [
      '--conditions=development',
      '-r',
      'ts-node/register',
      'src/maintenance/portal-users.ts',
      ...args,
    ],
    {
      cwd: join(__dirname, '..'),
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, DB_MYSQL_DB: database, LOG_LEVEL: 'info', ...env },
    },
  );
  if (result.error) throw result.error;
  return result;
}

const sleep = (ms: number) =>
  new Promise<'waiting'>((resolve) => setTimeout(() => resolve('waiting'), ms));

const person = (
  empid: string,
  overrides: Partial<SyntheticPerson> = {},
): SyntheticPerson => ({
  person_empid: empid,
  person_name: `𠮷野堃喆${empid}`,
  person_status: 1,
  department_id: 'D0100',
  department_name: '饗賓（台北）餐飲部',
  title: '主任',
  email: `${empid}@Example.TEST`,
  ...overrides,
});

describe('Portal 員工主檔匯入（合成 Portal）', () => {
  jest.setTimeout(240_000);
  let portal: SyntheticPortal;
  let db: DataSource;
  let context: TestingModule;
  let sync: PortalUserSyncService;
  let logs: jest.SpyInstance<void, [AppLogInput]>[];

  const loggedText = () => JSON.stringify(logs.map((spy) => spy.mock.calls));
  const snapshot = () =>
    db.query<Record<string, unknown>[]>(USERS_SNAPSHOT_SQL);

  beforeAll(async () => {
    const admin = await adminConnection();
    try {
      await admin.query(
        `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      );
    } finally {
      await admin.end();
    }
    db = await new DataSource(mysqlOptions()).initialize();
    await db.runMigrations();
    portal = await createSyntheticPortal();
    context = await startContext();
    sync = context.get(PortalUserSyncService);
  });

  beforeEach(async () => {
    logs = (['info', 'warn', 'error'] as const).map((level) =>
      jest.spyOn(AppLoggerService.prototype, level),
    );
    await portal.query('DELETE FROM sys_person');
    await db.query('DELETE FROM esign_signers');
    await db.query('DELETE FROM esign_documents');
    await db.query('DELETE FROM users');
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await context?.close();
    await db?.destroy();
    await portal?.drop();
    const admin = await adminConnection();
    try {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    } finally {
      await admin.end();
    }
  });

  it('5,001 人建立與更新正確，同來源第二次執行 0 變更；保留 ID、部門外鍵、登入紀錄與文件快照', async () => {
    await db.query(
      "INSERT INTO hr_departments (id, department_name) VALUES (7, '合成部門')",
    );
    const existing = await db.manager.save(User, {
      empid: '0000000',
      name: '合成舊姓名',
      email: 'old@example.test',
      departmentId: 7,
      departmentCode: 'OLD',
      departmentName: '舊部門',
      personStatus: '試用',
      isActive: true,
      lastLoginAt: new Date('2026-10-01T01:02:03.456Z'),
    });
    const inactive = await db.manager.save(User, {
      empid: '0000001',
      name: '合成停用者',
      isActive: false,
    });
    await db.query(
      "INSERT INTO esign_documents (id, doc_number, title, created_by_user_id, status, sign_start_at, sign_end_at) VALUES (1, UUID(), '合成文件', ?, 'active', '2026-10-01', '2026-12-31')",
      [existing.id],
    );
    await db.query(
      "INSERT INTO esign_signers (public_id, document_id, signer_type, user_id, email, empid_snapshot, name_snapshot, department_snapshot, title_snapshot) VALUES (UUID(), 1, 'user', ?, 'old@example.test', '0000000', '合成舊姓名', '舊部門', '舊職稱')",
      [existing.id],
    );
    const signersBefore = await db.query<unknown[]>(
      'SELECT * FROM esign_signers',
    );
    await portal.insertPeople(
      Array.from({ length: 5001 }, (_, i) =>
        person(String(i).padStart(7, '0'), i === 0 ? { email: '' } : {}),
      ),
    );
    const filesBefore = await workingFiles();

    const first = await sync.run({ trigger: 'schedule', dryRun: false });

    expect(first.summary).toMatchObject({
      trigger: 'schedule',
      sourceRows: 5001,
      eligibleEmployees: 5001,
      created: 4999,
      updated: 1,
      unchanged: 0,
      protected: 1,
      deactivated: 0,
      outcome: 'applied',
    });
    expect(Date.parse(first.summary.sourceAcquiredAt)).not.toBeNaN();
    expect(await db.manager.count(User)).toBe(5001);
    const updated = await db
      .getRepository(User)
      .createQueryBuilder('user')
      .addSelect('user.email')
      .where('user.empid = :empid', { empid: '0000000' })
      .getOneOrFail();
    expect(updated).toMatchObject({
      id: existing.id,
      name: '𠮷野堃喆0000000',
      email: null,
      departmentId: 7,
      departmentCode: 'D0100',
      departmentName: '饗賓（台北）餐飲部',
      personStatus: '正式',
      titleName: '主任',
      isActive: true,
      lastLoginAt: new Date('2026-10-01T01:02:03.456Z'),
    });
    const created = await db
      .getRepository(User)
      .createQueryBuilder('user')
      .addSelect('user.email')
      .where('user.empid = :empid', { empid: '0005000' })
      .getOneOrFail();
    expect(created).toMatchObject({
      name: '𠮷野堃喆0005000',
      email: '0005000@example.test',
      departmentCode: 'D0100',
      departmentName: '饗賓（台北）餐飲部',
      isActive: true,
      lastLoginAt: null,
      departmentId: null,
    });
    expect(
      await db.manager.findOneByOrFail(User, { id: inactive.id }),
    ).toMatchObject({ name: '合成停用者', isActive: false });
    expect(await db.query('SELECT * FROM esign_signers')).toEqual(
      signersBefore,
    );

    const afterFirst = await snapshot();
    const second = await sync.run({ trigger: 'schedule', dryRun: false });
    expect(second.summary).toMatchObject({
      created: 0,
      updated: 0,
      unchanged: 5000,
      protected: 1,
      deactivated: 0,
      outcome: 'applied',
    });
    expect(await snapshot()).toEqual(afterFirst);

    expect(await workingFiles()).toEqual(filesBefore);
    expect(JSON.stringify(afterFirst)).not.toContain(PORTAL_SENTINEL);
    expect(loggedText()).not.toContain(PORTAL_SENTINEL);
    expect(loggedText()).not.toContain('0005000');
  });

  it('不合法與衝突的員編只略過該員編，其餘照常匯入；本機資料不變，log 不含這些員編', async () => {
    await db.manager.save(User, [
      { empid: 'S000001', name: '合成缺姓名者', isActive: true },
      { empid: 'S000003', name: '合成衝突者', isActive: true },
    ]);
    const before = await snapshot();
    await portal.insertPeople([
      person('S000001', { person_name: ' ' }),
      person('S000002', { email: 'not-an-email' }),
      person('S000003'),
      person('S000003', { person_name: '不同姓名' }),
      person('Sx00004'),
      person('SX00004'),
      person('BAD-0005'),
      person('S000006'),
      person('S000006'),
      person('S000007'),
    ]);

    const result = await sync.run({ trigger: 'schedule', dryRun: false });

    expect(result.summary).toMatchObject({
      sourceRows: 10,
      eligibleEmployees: 2,
      created: 2,
      updated: 0,
      deactivated: 0,
      skipped: {
        missing_name: 1,
        invalid_email: 1,
        too_long: 0,
        invalid_empid: 1,
        conflict: 3,
      },
      outcome: 'applied',
    });
    expect(result.skipped).toBeUndefined();
    const after = await snapshot();
    expect(after.filter((r) => before.some((b) => b.id === r.id))).toEqual(
      before,
    );
    expect(after.map((r) => r.empid).sort()).toEqual([
      'S000001',
      'S000003',
      'S000006',
      'S000007',
    ]);
    const text = loggedText();
    expect(text).toContain('portal_users.sync_completed');
    for (const empid of [
      'S000001',
      'S000002',
      'S000003',
      'Sx00004',
      'SX00004',
      'BAD-0005',
    ]) {
      expect(text).not.toContain(empid);
    }
  });

  it('dry-run 不寫入，回傳被略過的員編與原因，log 不含這些員編', async () => {
    await db.manager.save(User, {
      empid: 'R000003',
      name: '合成離職者',
      isActive: true,
    });
    await portal.insertPeople([
      person('R000001'),
      person('R000002', { person_name: '' }),
      person('R000003', { person_status: 2 }),
    ]);
    const before = await snapshot();

    const result = await sync.run({ trigger: 'manual', dryRun: true });

    expect(result.summary).toMatchObject({
      trigger: 'manual',
      created: 1,
      deactivated: 1,
      skipped: { missing_name: 1 },
      outcome: 'dry_run',
    });
    expect(result.skipped).toEqual([
      { empid: 'R000002', reason: 'missing_name' },
    ]);
    expect(await snapshot()).toEqual(before);
    expect(loggedText()).not.toContain('R000002');
  });

  it('停用 Portal 明確非在職的人；查無或只差大小寫不動；已停用、軟刪除與恢復在職者不自動恢復', async () => {
    await db.manager.save(User, [
      { empid: 'D000001', name: '合成離職一', isActive: true },
      { empid: 'D000002', name: '合成離職二', isActive: true },
      { empid: 'D000003', name: '合成查無', isActive: true },
      { empid: 'D000004', name: '合成已停用', isActive: false },
      {
        empid: 'D000005',
        name: '合成已刪除',
        isActive: true,
        deletedAt: new Date('2026-01-01T00:00:00Z'),
      },
      { empid: 'd000006', name: '合成大小寫', isActive: true },
    ]);
    await portal.insertPeople([
      person('D000001', { person_status: 2 }),
      person('D000002', { person_status: 4 }),
      person('D000002', { person_status: 5 }),
      person('D000004'),
      person('D000005'),
      person('D000006', { person_status: 2 }),
    ]);
    const before = await snapshot();

    const result = await sync.run({ trigger: 'schedule', dryRun: false });

    expect(result.summary).toMatchObject({
      created: 0,
      updated: 0,
      protected: 2,
      deactivated: 2,
      outcome: 'applied',
    });
    const after = await snapshot();
    const byEmpid = (rows: Record<string, unknown>[], empid: string) =>
      rows.find((r) => r.empid === empid)!;
    for (const empid of ['D000001', 'D000002']) {
      const { is_active, updated_at, ...rest } = byEmpid(after, empid);
      const { updated_at: previous, ...original } = byEmpid(before, empid);
      expect(is_active).toBe(0);
      expect(updated_at).not.toBe(previous);
      expect(rest).toEqual({ ...original, is_active: undefined });
    }
    for (const empid of ['D000003', 'D000004', 'D000005', 'd000006']) {
      expect(byEmpid(after, empid)).toEqual(byEmpid(before, empid));
    }

    await portal.query('UPDATE sys_person SET person_status = 1');
    const restored = await sync.run({ trigger: 'schedule', dryRun: false });
    expect(restored.summary).toMatchObject({ protected: 4, deactivated: 0 });
    expect(
      (await snapshot())
        .filter((r) => r.empid !== 'D000003' && r.empid !== 'd000006')
        .map((r) => r.is_active),
    ).toEqual([0, 0, 0, 1]);
  });

  it('剛好 500 人可停用；501 人整批不寫入並記錄，確認人數相符才套用', async () => {
    const departing = (prefix: string, count: number) =>
      Array.from(
        { length: count },
        (_, i) => `${prefix}${String(i).padStart(6, '0')}`,
      );
    const first = departing('T', 501);
    await db.manager.insert(
      User,
      first.map((empid) => ({ empid, name: '合成離職者', isActive: true })),
    );
    await portal.insertPeople([
      ...first.map((empid) => person(empid, { person_status: 2 })),
      person('N000001'),
    ]);
    const before = await snapshot();

    const blocked = await sync.run({ trigger: 'schedule', dryRun: false });
    expect(blocked.summary).toMatchObject({
      created: 1,
      deactivated: 501,
      outcome: 'blocked_deactivation_threshold',
    });
    expect(await snapshot()).toEqual(before);
    const [[blockedLog], ...otherWarnings] = logs[1].mock.calls;
    expect(otherWarnings).toEqual([]);
    expect(blockedLog.event).toBe('portal_users.sync_blocked');
    expect(blockedLog.metadata).toMatchObject({ deactivated: 501 });

    const mismatched = await sync.run({
      trigger: 'manual',
      dryRun: false,
      confirmedDeactivations: 500,
    });
    expect(mismatched.summary.outcome).toBe('blocked_deactivation_threshold');
    expect(await snapshot()).toEqual(before);

    const confirmed = await sync.run({
      trigger: 'manual',
      dryRun: false,
      confirmedDeactivations: 501,
    });
    expect(confirmed.summary).toMatchObject({
      created: 1,
      deactivated: 501,
      outcome: 'applied',
    });
    expect(await db.manager.countBy(User, { isActive: true })).toBe(1);

    const second = departing('U', 500);
    await db.manager.insert(
      User,
      second.map((empid) => ({ empid, name: '合成離職者', isActive: true })),
    );
    await portal.insertPeople(
      second.map((empid) => person(empid, { person_status: 2 })),
    );
    const exact = await sync.run({ trigger: 'schedule', dryRun: false });
    expect(exact.summary).toMatchObject({
      deactivated: 500,
      outcome: 'applied',
    });
    expect(await db.manager.countBy(User, { isActive: true })).toBe(1);
  });

  it('CLI sync --dry-run 不寫入；stdout 列出摘要、被略過的員編與原因、要停用的人數，log 不含被略過的員編', async () => {
    await db.manager.save(User, {
      empid: 'M000003',
      name: '合成離職者',
      isActive: true,
    });
    await portal.insertPeople([
      person('M000001'),
      person('M000002', { person_name: '' }),
      person('M000003', { person_status: 2 }),
    ]);
    const before = await snapshot();

    const { status, stdout } = runCli(['sync', '--dry-run']);

    expect(status).toBe(0);
    expect(await snapshot()).toEqual(before);
    const lines = stdout.split('\n');
    const summary = lines.find((line) => line.startsWith('摘要：'));
    expect(JSON.parse(summary!.slice('摘要：'.length))).toMatchObject({
      trigger: 'manual',
      created: 1,
      deactivated: 1,
      skipped: { missing_name: 1 },
      outcome: 'dry_run',
    });
    expect(lines).toContain('略過：M000002（missing_name）');
    expect(lines).toContain('要停用：1 人');
    // log 與 CLI 輸出同在 stdout：log 確實有輸出，但被略過的員編只出現在 CLI 的那一行。
    expect(stdout).toContain('portal_users.sync_completed');
    expect(lines.filter((line) => line.includes('M000002'))).toEqual([
      '略過：M000002（missing_name）',
    ]);
  });

  it('CLI 停用人數超過門檻時，不帶 --allow-deactivations 或 N 不符都以非零狀態結束且不寫入；N 相符才套用', async () => {
    const departing = Array.from(
      { length: 501 },
      (_, i) => `Q${String(i).padStart(6, '0')}`,
    );
    await db.manager.insert(
      User,
      departing.map((empid) => ({ empid, name: '合成離職者', isActive: true })),
    );
    await portal.insertPeople(
      departing.map((empid) => person(empid, { person_status: 2 })),
    );
    const before = await snapshot();

    for (const args of [['sync'], ['sync', '--allow-deactivations', '500']]) {
      const blocked = runCli(args);
      expect(blocked.status).toBe(1);
      expect(blocked.stderr).toContain('--allow-deactivations 501');
      expect(await snapshot()).toEqual(before);
    }

    const confirmed = runCli(['sync', '--allow-deactivations', '501']);
    expect(confirmed.status).toBe(0);
    expect(await db.manager.countBy(User, { isActive: true })).toBe(0);
  });

  it('CLI 參數不合法或 Portal 讀取失敗時以非零狀態結束，本機不寫入', async () => {
    await portal.insertPeople([person('E000001')]);
    const before = await snapshot();

    for (const args of [
      ['sync', '--input', '/imports/portal_users.hex.tsv'],
      ['rollback', '--preview', '/imports/rollback-001.json'],
    ]) {
      const rejected = runCli(args);
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain('sync --dry-run');
    }
    const failed = runCli(['sync'], {
      PORTAL_MYSQL_DB: `${process.env.PORTAL_MYSQL_DB}_missing`,
    });
    expect(failed.status).toBe(1);
    expect(failed.stdout).toContain('portal_users.sync_failed');
    expect(await snapshot()).toEqual(before);
  });

  it('Portal 故障或權限不足時只拋出分類錯誤，本機 0 變更；log 與錯誤不含 Portal 主機、帳號、資料庫或員編', async () => {
    await db.manager.save(User, {
      empid: 'F000001',
      name: '合成在職者',
      isActive: true,
    });
    await portal.insertPeople([
      person('F000001', { person_status: 2 }),
      person('F000002'),
    ]);
    const before = await snapshot();

    await portal.query('RENAME TABLE sys_person TO sys_person_hidden');
    const missingTable = await sync
      .run({ trigger: 'schedule', dryRun: false })
      .catch((error: unknown) => error)
      .finally(() =>
        portal.query('RENAME TABLE sys_person_hidden TO sys_person'),
      );
    const denied = await startContext(
      portalConfigFrom({
        PORTAL_MYSQL_HOST: process.env.PORTAL_MYSQL_HOST!,
        PORTAL_MYSQL_PORT: process.env.PORTAL_MYSQL_PORT!,
        PORTAL_MYSQL_USER: process.env.PORTAL_MYSQL_USER!,
        PORTAL_MYSQL_PASS: 'wrong-synthetic-password',
        PORTAL_MYSQL_DB: process.env.PORTAL_MYSQL_DB!,
      }),
    );
    const accessDenied = await denied
      .get(PortalUserSyncService)
      .run({ trigger: 'manual', dryRun: false })
      .catch((error: unknown) => error)
      .finally(() => denied.close());

    expect(missingTable).toBeInstanceOf(PortalUserSyncError);
    expect(missingTable).toMatchObject({
      stage: 'source',
      errorType: 'ER_NO_SUCH_TABLE',
    });
    expect(accessDenied).toMatchObject({
      stage: 'source',
      errorType: 'ER_ACCESS_DENIED_ERROR',
    });
    expect(await snapshot()).toEqual(before);
    const failures = logs[2].mock.calls.map(([entry]) => entry);
    expect(failures.map((entry) => entry.event)).toEqual([
      'portal_users.sync_failed',
      'portal_users.sync_failed',
    ]);
    expect(failures.map((entry) => entry.metadata)).toMatchObject([
      {
        trigger: 'schedule',
        outcome: 'failed_source',
        errorType: 'ER_NO_SUCH_TABLE',
      },
      {
        trigger: 'manual',
        outcome: 'failed_source',
        errorType: 'ER_ACCESS_DENIED_ERROR',
      },
    ]);
    const exposed = [
      loggedText(),
      String(missingTable),
      String(accessDenied),
      (missingTable as Error).stack,
      (accessDenied as Error).stack,
    ].join('\n');
    for (const secret of [
      process.env.PORTAL_MYSQL_DB!,
      process.env.PORTAL_MYSQL_HOST!,
      process.env.PORTAL_MYSQL_USER!,
      'localhost',
      'F000001',
      'F000002',
    ]) {
      expect(exposed).not.toContain(secret);
    }
  });

  it('寫入途中失敗整批回滾，錯誤與 log 不含員編', async () => {
    await db.manager.save(User, {
      empid: 'W000003',
      name: '合成離職者',
      isActive: true,
    });
    await portal.insertPeople([
      person('W000001'),
      person('W000002'),
      person('W000003', { person_status: 2 }),
    ]);
    const before = await snapshot();
    let calls = 0;
    jest
      .spyOn(UserRepository.prototype, 'save')
      .mockImplementation((user, manager) => {
        if (++calls === 2) {
          const error = new Error(
            `Duplicate entry '${user.empid}' for key 'users.uq_users_empid'`,
          );
          return Promise.reject(Object.assign(error, { code: 'ER_DUP_ENTRY' }));
        }
        return manager.save(user);
      });

    const error = await sync
      .run({ trigger: 'schedule', dryRun: false })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PortalUserSyncError);
    expect(error).toMatchObject({ stage: 'write', errorType: 'ER_DUP_ENTRY' });
    expect(calls).toBe(2);
    expect(await snapshot()).toEqual(before);
    const exposed = `${loggedText()}\n${String(error)}\n${(error as Error).stack}`;
    for (const empid of ['W000001', 'W000002', 'W000003']) {
      expect(exposed).not.toContain(empid);
    }
  });

  it('匯入交易進行中，登入寫入同一員工會等待匯入提交，沒有互相覆蓋或部分寫入', async () => {
    const users = new UserRepository();
    await db.manager.save(User, {
      empid: 'C000001',
      name: '合成舊姓名',
      departmentName: '舊部門',
      isActive: true,
    });
    // C000002 排在前面：匯入先建立它（尚未 commit）後暫停，此時 C000001 只靠交易開頭的 FOR UPDATE 鎖住。
    await portal.insertPeople([person('C000002'), person('C000001')]);
    const before = await snapshot();

    let paused!: () => void;
    let resume!: () => void;
    const pausedImport = new Promise<void>((resolve) => (paused = resolve));
    const resumeImport = new Promise<void>((resolve) => (resume = resolve));
    const saved: string[] = [];
    jest
      .spyOn(UserRepository.prototype, 'save')
      .mockImplementation(async (user, manager) => {
        const result = await manager.save(user);
        saved.push(user.empid);
        if (saved.length === 1) {
          paused();
          await resumeImport;
        }
        return result;
      });
    const importing = sync.run({ trigger: 'schedule', dryRun: false });
    await pausedImport;
    expect(saved).toEqual(['C000002']);

    // 照登入的 findOrCreateUser：鎖定同一員工後寫入姓名與登入時間。
    const loginAt = new Date('2026-11-03T20:00:00.123Z');
    const login = db.transaction(async (manager) => {
      const user = await users.findByEmpidForUpdate('C000001', manager);
      user!.name = '登入寫入姓名';
      user!.lastLoginAt = loginAt;
      return users.save(user!, manager);
    });
    expect(await Promise.race([login.then(() => 'done'), sleep(1_000)])).toBe(
      'waiting',
    );
    expect(await snapshot()).toEqual(before);

    resume();
    expect((await importing).summary).toMatchObject({ created: 1, updated: 1 });
    await login;

    expect(saved).toEqual(['C000002', 'C000001', 'C000001']);
    const after = await db
      .getRepository(User)
      .findOneByOrFail({ empid: 'C000001' });
    expect(after).toMatchObject({
      name: '登入寫入姓名',
      lastLoginAt: loginAt,
      departmentName: '饗賓（台北）餐飲部',
      titleName: '主任',
    });
    expect(await db.manager.countBy(User, { empid: 'C000002' })).toBe(1);
  });
});
