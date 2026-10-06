// rbac.seed.ts — 冪等種子：權限字典 + ADMIN 角色 + ADMIN 全權限對應（FR-026 / SC-007）。
// 以唯一鍵 upsert 達成冪等（連跑兩次計數不變）。
// 註：auth_apis / 預設 auth_api_permissions 由 @RegisterApi 開機同步負責，不在此 seed。
//
// CLI 執行：pnpm -C server seed:rbac
import { DataSource } from 'typeorm';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';
import { AuthGroup } from '#app/features/auth/entities/auth-group.entity';
import { AuthGroupJob } from '#app/features/auth/entities/auth-group-job.entity';
import { AuthJobPermission } from '#app/features/auth/entities/auth-job-permission.entity';
import { AuthRole } from '#app/features/auth/entities/auth-role.entity';
import { AuthRolePermission } from '#app/features/auth/entities/auth-role-permission.entity';
import { AuthUser } from '#app/features/auth/entities/auth-user.entity';
import { ADMIN_ROLE_CODE } from '#app/features/auth/auth.constants';
import {
  DictGroup,
  DictJob,
  DictPermission,
  PERMISSION_DICTIONARY,
} from '#app/features/auth/seeds/permission-dictionary';

export async function seedRbac(dataSource: DataSource): Promise<void> {
  await seedDictionary(dataSource);
  const adminRoleId = await seedAdminRole(dataSource);
  await seedSuperAdminUser(dataSource, adminRoleId);
}

/** 寫入三層權限字典（group → job → permission），sort_order 依陣列序。 */
async function seedDictionary(ds: DataSource): Promise<void> {
  for (const [groupIndex, group] of PERMISSION_DICTIONARY.entries()) {
    const groupId = await upsertGroup(ds, group, groupIndex);
    for (const [jobIndex, job] of group.jobs.entries()) {
      const jobId = await upsertJob(ds, groupId, job, jobIndex);
      for (const [permIndex, permission] of job.permissions.entries()) {
        await upsertPermission(ds, jobId, permission, permIndex);
      }
    }
  }
}

async function upsertGroup(
  ds: DataSource,
  group: DictGroup,
  sortOrder: number,
): Promise<number> {
  const repo = ds.getRepository(AuthGroup);
  await repo.upsert(
    {
      groupKey: group.groupKey,
      groupName: group.groupName,
      sortOrder,
      isActive: true,
    },
    ['groupKey'],
  );
  const row = await repo.findOneByOrFail({ groupKey: group.groupKey });
  return row.id;
}

async function upsertJob(
  ds: DataSource,
  groupId: number,
  job: DictJob,
  sortOrder: number,
): Promise<number> {
  const repo = ds.getRepository(AuthGroupJob);
  await repo.upsert(
    {
      groupId,
      jobKey: job.jobKey,
      jobName: job.jobName,
      sortOrder,
      isActive: true,
    },
    ['groupId', 'jobKey'],
  );
  const row = await repo.findOneByOrFail({ groupId, jobKey: job.jobKey });
  return row.id;
}

async function upsertPermission(
  ds: DataSource,
  jobId: number,
  permission: DictPermission,
  sortOrder: number,
): Promise<void> {
  await ds.getRepository(AuthJobPermission).upsert(
    {
      jobId,
      permissionKey: permission.permissionKey,
      action: permission.action,
      permissionName: permission.permissionName,
      sortOrder,
    },
    ['permissionKey'],
  );
}

/** 建立 ADMIN 角色（is_admin）並綁定當前所有權限（全權限）；回傳 ADMIN role id。 */
async function seedAdminRole(ds: DataSource): Promise<number> {
  const roleRepo = ds.getRepository(AuthRole);
  await roleRepo.upsert(
    {
      roleCode: ADMIN_ROLE_CODE,
      roleName: '系統管理員',
      isAdmin: true,
      isActive: true,
      sortOrder: 0,
    },
    ['roleCode'],
  );
  const admin = await roleRepo.findOneByOrFail({ roleCode: ADMIN_ROLE_CODE });

  const permissions = await ds.getRepository(AuthJobPermission).find();
  const rolePermRepo = ds.getRepository(AuthRolePermission);
  for (const permission of permissions) {
    await rolePermRepo.upsert(
      { roleId: admin.id, permissionId: permission.id },
      ['roleId', 'permissionId'],
    );
  }
  return admin.id;
}

/**
 * 將初始管理員（.env SUPER_ADMIN_EMPID，填員工編號）綁定 ADMIN 角色。
 * 登入一律走統一登入：該員工以 OAuth 登入時依員編對到此帳號，即取得管理權限。
 * 帳號已存在（例如已用統一登入登入過）只補綁角色並啟用，不覆蓋姓名等同步欄位；
 * 不存在則預建，姓名先放佔位值，首次登入時由統一登入的 UserInfo 更新。
 * 未設 SUPER_ADMIN_EMPID 則略過（非致命，僅提示）。
 */
async function seedSuperAdminUser(
  ds: DataSource,
  adminRoleId: number,
): Promise<void> {
  const empid = process.env.SUPER_ADMIN_EMPID;
  if (!empid) {
    console.warn('[seed:rbac] 未設 SUPER_ADMIN_EMPID，略過初始管理員綁定');
    return;
  }
  const userRepo = ds.getRepository(AuthUser);
  const existing = await userRepo.findOneBy({ personEmpid: empid });
  if (existing) {
    await userRepo.update(
      { id: existing.id },
      { roleId: adminRoleId, isActive: true },
    );
    return;
  }
  await userRepo.insert({
    personEmpid: empid,
    personName: '超級管理員',
    roleId: adminRoleId,
    isActive: true,
  });
}

/** CLI 進入點（pnpm seed:rbac）。 */
async function runAsCli(): Promise<void> {
  const dataSource = new DataSource(buildMysqlOptions());
  await dataSource.initialize();
  try {
    await seedRbac(dataSource);
    console.log('[seed:rbac] 完成');
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  runAsCli().catch((err) => {
    console.error('[seed:rbac] 失敗', err);
    process.exit(1);
  });
}
