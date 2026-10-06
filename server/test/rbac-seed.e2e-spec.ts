import { DataSource } from 'typeorm';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';
import { seedRbac } from '#app/infrastructure/database/seeds/rbac.seed';

describe('RBAC seed 冪等 (e2e)', () => {
  let ds: DataSource;

  const COUNT_TABLES = [
    'auth_group',
    'auth_group_jobs',
    'auth_job_permission',
    'auth_roles',
    'auth_role_permissions',
    'auth_users',
  ];

  const snapshotCounts = async (): Promise<Record<string, number>> => {
    const out: Record<string, number> = {};
    for (const table of COUNT_TABLES) {
      const rows = await ds.query<Array<{ c: number }>>(
        `SELECT COUNT(*) AS c FROM ${table}`,
      );
      out[table] = Number(rows[0].c);
    }
    return out;
  };

  beforeAll(async () => {
    ds = new DataSource(buildMysqlOptions());
    await ds.initialize();
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('連跑兩次 seed，各表計數不變（冪等）', async () => {
    await seedRbac(ds);
    const first = await snapshotCounts();
    await seedRbac(ds);
    const second = await snapshotCounts();

    expect(second).toEqual(first);
  });

  it('ADMIN 角色綁定全部功能權限', async () => {
    const [admin] = await ds.query<Array<{ id: number }>>(
      `SELECT id FROM auth_roles WHERE role_code = 'ADMIN' LIMIT 1`,
    );
    expect(admin).toBeDefined();

    const [{ c: permTotal }] = await ds.query<Array<{ c: number }>>(
      `SELECT COUNT(*) AS c FROM auth_job_permission`,
    );
    const [{ c: adminBound }] = await ds.query<Array<{ c: number }>>(
      `SELECT COUNT(*) AS c FROM auth_role_permissions WHERE role_id = ?`,
      [admin.id],
    );

    expect(Number(permTotal)).toBeGreaterThan(0);
    expect(Number(adminBound)).toBe(Number(permTotal));
  });

  it('超級使用者已建立並綁 ADMIN 角色', async () => {
    const empid = process.env.SUPER_ADMIN_EMPID;
    expect(empid).toBeTruthy();

    const rows = await ds.query<Array<{ id: number }>>(
      `SELECT u.id
         FROM auth_users u
         JOIN auth_roles r ON r.id = u.role_id
        WHERE u.person_empid = ? AND r.role_code = 'ADMIN'
        LIMIT 1`,
      [empid],
    );
    expect(rows.length).toBe(1);
  });
});
