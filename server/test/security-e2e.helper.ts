// security-e2e.helper.ts
// 034 安全對抗套件共用 harness。
//
// 提供合成的角色與身分（admin／viewer／無權／停用），驗證 401／403／RBAC 等安全行為。
// 自行寫入 Redis session key（AuthGuard 會查 `auth:<userId>:<token>`，只簽 JWT 不寫
// session 會被判定失效）。

import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { AppModule } from '#app/app.module';
import {
  configureApp,
  registerFastifyPlugins,
} from '#app/bootstrap/app.bootstrap';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import {
  AUTH_COOKIE_NAME,
  AUTH_TOKEN_TTL_SECONDS,
} from '#app/features/auth/auth.constants';
import { RedisService } from '#app/infrastructure/database/redis/redis.service';
import { AuthRole } from '#app/features/auth/entities/auth-role.entity';
import { AuthRolePermission } from '#app/features/auth/entities/auth-role-permission.entity';
import { AuthJobPermission } from '#app/features/auth/entities/auth-job-permission.entity';
import { AuthUser } from '#app/features/auth/entities/auth-user.entity';
import {
  ACCOUNT_MANAGEMENT,
  ROLE_MANAGEMENT,
} from '#app/features/auth/seeds/permission-dictionary';
import type { E2eServer } from './api-response.helper';

export type { E2eServer };

/** 合成角色代碼（一望即知為假；不與正式 seed 的 ADMIN 衝突）。 */
const SEC_ROLE_VIEWER = 'SEC_VIEWER';
const SEC_ROLE_NOPERM = 'SEC_NOPERM';

/** 合成使用者工號前綴——resetSecurityFixtures 以此前綴清場。 */
const SEC_EMP_PREFIX = 'sec-';

/** 合成身分的工號（供需經真實 API 操作特定帳號的測試使用，如 SEC-06 停用）。 */
export const SECURITY_EMPIDS = {
  admin: `${SEC_EMP_PREFIX}admin`,
  viewer: `${SEC_EMP_PREFIX}viewer`,
  viewerB: `${SEC_EMP_PREFIX}viewer-b`,
  noPerm: `${SEC_EMP_PREFIX}noperm`,
  disabled: `${SEC_EMP_PREFIX}disabled`,
} as const;

/** viewer 角色的權限集合：角色管理 / 帳號管理僅檢視。 */
const VIEWER_PERMISSION_KEYS: string[] = [
  ROLE_MANAGEMENT.VIEW,
  ACCOUNT_MANAGEMENT.VIEW,
];

export interface SecurityE2eContext {
  app: NestFastifyApplication;
  server: E2eServer;
  ds: DataSource;
  jwt: JwtService;
  redis: RedisService;
}

/** 合成身分的 user id（seedSecurityRbac 回傳）。 */
export interface SecurityIdentities {
  adminUserId: number;
  viewerUserId: number;
  viewerBUserId: number;
  noPermUserId: number;
  disabledUserId: number;
}

/**
 * 建立測試 app。
 * 與正式 bootstrap 同 configureApp（全域 AuthGuard）＋ registerFastifyPlugins
 * （安全標頭 / cookie / multipart）。
 * `override` 供需要替換外部依賴的套件使用（例：以 mock 取代饗賓 API）。
 */
export async function createSecurityE2eApp(
  override: (builder: TestingModuleBuilder) => TestingModuleBuilder = (
    builder,
  ) => builder,
): Promise<SecurityE2eContext> {
  const moduleRef = await override(
    Test.createTestingModule({ imports: [AppModule] }),
  ).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  configureApp(app);
  await registerFastifyPlugins(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const server: E2eServer = app.getHttpAdapter().getInstance().server;
  const ds = app.get<DataSource>(MYSQL_MAIN);
  const jwt = app.get(JwtService, { strict: false });
  const redis = app.get(RedisService, { strict: false });
  return { app, server, ds, jwt, redis };
}

export async function closeSecurityE2eApp(
  ctx: SecurityE2eContext,
): Promise<void> {
  await ctx.app.close();
}

/**
 * 冪等種子：建立合成 viewer / no-permission 角色與五個合成身分。
 * 依賴 global-setup 已種好的權限字典（PERMISSION_DICTIONARY）與 ADMIN 角色。
 */
export async function seedSecurityRbac(
  ctx: SecurityE2eContext,
): Promise<SecurityIdentities> {
  const { ds } = ctx;

  const viewerRoleId = await upsertRole(
    ds,
    SEC_ROLE_VIEWER,
    '安全測試檢視角色',
    VIEWER_PERMISSION_KEYS,
  );
  const noPermRoleId = await upsertRole(
    ds,
    SEC_ROLE_NOPERM,
    '安全測試無權角色',
    [],
  );
  const adminRoleId = await findAdminRoleId(ds);

  const adminUserId = await upsertUser(
    ds,
    `${SEC_EMP_PREFIX}admin`,
    '測試管理員',
    adminRoleId,
    true,
  );
  const viewerUserId = await upsertUser(
    ds,
    `${SEC_EMP_PREFIX}viewer`,
    '測試檢視員一號',
    viewerRoleId,
    true,
  );
  const viewerBUserId = await upsertUser(
    ds,
    `${SEC_EMP_PREFIX}viewer-b`,
    '測試檢視員二號',
    viewerRoleId,
    true,
  );
  const noPermUserId = await upsertUser(
    ds,
    `${SEC_EMP_PREFIX}noperm`,
    '測試無權員',
    noPermRoleId,
    true,
  );
  const disabledUserId = await upsertUser(
    ds,
    `${SEC_EMP_PREFIX}disabled`,
    '測試停用員',
    viewerRoleId,
    false,
  );

  return {
    adminUserId,
    viewerUserId,
    viewerBUserId,
    noPermUserId,
    disabledUserId,
  };
}

/**
 * 為指定 user 產生有效 session：簽 JWT + 寫 Redis `auth:<userId>:<token>`，
 * 回傳可直接 `.set('Cookie', ...)` 的 cookie 字串。
 * session value 對齊 AuthSessionService.issue（目前版本；合成身分無上游 refresh token）。
 */
export async function issueSession(
  ctx: SecurityE2eContext,
  userId: number,
): Promise<string> {
  const token = ctx.jwt.sign(
    { sub: String(userId) },
    { expiresIn: AUTH_TOKEN_TTL_SECONDS },
  );
  await ctx.redis.set(
    `auth:${userId}:${token}`,
    JSON.stringify({ version: 3, encryptedRefreshToken: null }),
    AUTH_TOKEN_TTL_SECONDS,
  );
  return `${AUTH_COOKIE_NAME}=${token}`;
}

/** 停用帳號（is_active=false）；SEC-06 停用殘留情境用。 */
export async function setUserActive(
  ctx: SecurityE2eContext,
  userId: number,
  isActive: boolean,
): Promise<void> {
  await ctx.ds.getRepository(AuthUser).update({ id: userId }, { isActive });
}

/**
 * 清場（afterAll）：刪除本套件合成的使用者/角色關聯/角色，並清掉其 Redis session。
 * 硬刪僅限測試 DB（feastogether_intranet_test*，globalSetup 已 fail-closed 驗證）。
 */
export async function resetSecurityFixtures(
  ctx: SecurityE2eContext,
): Promise<void> {
  const { ds, redis } = ctx;
  // 清 Redis session（本套件 empid 皆 sec- 前綴 → 逐 user 撤）
  const users: Array<{ id: number }> = await ds.query(
    `SELECT id FROM auth_users WHERE person_empid LIKE ?`,
    [`${SEC_EMP_PREFIX}%`],
  );
  for (const { id } of users) {
    const keys = await scanRedisKeys(redis, `auth:${id}:*`);
    for (const key of keys) await redis.del(key);
  }
  // 合成角色的權限關聯 → 使用者 → 角色（硬刪，測試 DB 專用）
  await ds.query(
    `DELETE rp FROM auth_role_permissions rp
       JOIN auth_roles r ON r.id = rp.role_id
      WHERE r.role_code IN (?, ?)`,
    [SEC_ROLE_VIEWER, SEC_ROLE_NOPERM],
  );
  await ds.query(`DELETE FROM auth_users WHERE person_empid LIKE ?`, [
    `${SEC_EMP_PREFIX}%`,
  ]);
  await ds.query(`DELETE FROM auth_roles WHERE role_code IN (?, ?)`, [
    SEC_ROLE_VIEWER,
    SEC_ROLE_NOPERM,
  ]);
}

// ── 內部 helpers ─────────────────────────────────────────────

async function upsertRole(
  ds: DataSource,
  roleCode: string,
  roleName: string,
  permissionKeys: string[],
): Promise<number> {
  const roleRepo = ds.getRepository(AuthRole);
  await roleRepo.upsert(
    { roleCode, roleName, isAdmin: false, isActive: true, sortOrder: 900 },
    ['roleCode'],
  );
  const role = await roleRepo.findOneByOrFail({ roleCode });

  const jpRepo = ds.getRepository(AuthJobPermission);
  const rpRepo = ds.getRepository(AuthRolePermission);
  for (const permissionKey of permissionKeys) {
    const jp = await jpRepo.findOneByOrFail({ permissionKey });
    await rpRepo.upsert({ roleId: role.id, permissionId: jp.id }, [
      'roleId',
      'permissionId',
    ]);
  }
  return role.id;
}

async function findAdminRoleId(ds: DataSource): Promise<number> {
  const role = await ds
    .getRepository(AuthRole)
    .findOneByOrFail({ roleCode: 'ADMIN' });
  return role.id;
}

async function upsertUser(
  ds: DataSource,
  personEmpid: string,
  personName: string,
  roleId: number,
  isActive: boolean,
): Promise<number> {
  const repo = ds.getRepository(AuthUser);
  await repo.upsert({ personEmpid, personName, roleId, isActive }, [
    'personEmpid',
  ]);
  const user = await repo.findOneByOrFail({ personEmpid });
  return user.id;
}

/** 以 SCAN 取匹配 key（避免 KEYS 阻塞；測試 DB 量小）。 */
async function scanRedisKeys(
  redis: RedisService,
  pattern: string,
): Promise<string[]> {
  // RedisService 未直接暴露 scan；透過其 client 執行。測試專用。
  const client = (redis as unknown as { client: import('ioredis').Redis })
    .client;
  const found: string[] = [];
  let cursor = '0';
  do {
    const [next, keys] = await client.scan(
      cursor,
      'MATCH',
      pattern,
      'COUNT',
      100,
    );
    cursor = next;
    found.push(...keys);
  } while (cursor !== '0');
  return found;
}
