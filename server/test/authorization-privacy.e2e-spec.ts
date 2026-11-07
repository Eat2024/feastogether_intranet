import { PinoLogger } from 'nestjs-pino';
import { PortalDirectoryService } from '#app/infrastructure/portal/portal-directory.service';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import {
  withAuthorizationDatabase,
  initializeAuthorizationOperator,
} from './helpers/authorization-fixtures';
import { createAuthorizationSession } from './helpers/authorization-http-fixtures';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
} from './security-e2e.helper';
import { createSyntheticPortal } from './synthetic-portal.helper';

jest.setTimeout(120_000);
it('response、access log及audit不洩漏員編body／cookie／上游原始錯誤；403與目標422不撤銷session', async () => {
  const logs: unknown[] = [];
  for (const level of ['info', 'warn', 'error'] as const)
    jest
      .spyOn(PinoLogger.prototype, level)
      .mockImplementation((...args: unknown[]) => {
        logs.push(args);
      });
  const empId = 'AZPRIVACY01';
  const rawError = 'PORTAL_RAW_SECRET_SENTINEL';
  const signature = 'SIGNATURE_BYTES_SENTINEL';
  const portal = await createSyntheticPortal();
  try {
    await portal.insertPeople([
      {
        person_empid: empId,
        person_name: '合成隱私員工',
        person_status: 1,
        department_id: 'AZPRIV',
        department_name: '合成部門',
      },
    ]);
    await withAuthorizationDatabase(async (db) => {
      await initializeAuthorizationOperator(db);
      const ctx = await createSecurityE2eApp((builder) =>
        builder.overrideProvider(MYSQL_MAIN).useValue(db),
      );
      try {
        const cookie = await createAuthorizationSession(ctx.app, {
          kind: 'super_user',
        });
        const headers = { cookie, origin: 'http://localhost:3000' };
        const [role] = await db.query<Array<{ id: number }>>(
          "SELECT id FROM authorization_roles WHERE role_code='document_creator'",
        );
        const url =
          '/api/authorization/modules/esign/employee-role-assignments';
        const responses: string[] = [];
        const assigned = await ctx.app.inject({
          method: 'POST',
          url,
          headers,
          payload: { empId, roleIds: [String(role.id)], expectedRoleIds: [] },
        });
        expect(assigned.statusCode).toBe(200);
        responses.push(assigned.body);
        const rejected = await ctx.app.inject({
          method: 'POST',
          url,
          headers,
          payload: {
            empId: 'AZPRIVACY-MISSING',
            roleIds: [],
            expectedRoleIds: [],
          },
        });
        expect(rejected.statusCode).toBe(422);
        expect(rejected.headers['set-cookie']).toBeUndefined();
        responses.push(rejected.body);
        const invalid = await ctx.app.inject({
          method: 'POST',
          url,
          headers,
          payload: { empId, roleIds: [], expectedRoleIds: [], signature },
        });
        expect(invalid.statusCode).toBe(400);
        responses.push(invalid.body);
        jest
          .spyOn(ctx.app.get(PortalDirectoryService), 'findEmployeesByEmpid')
          .mockRejectedValueOnce(new Error(rawError));
        const unavailable = await ctx.app.inject({
          method: 'POST',
          url,
          headers,
          payload: { empId, roleIds: [], expectedRoleIds: [String(role.id)] },
        });
        expect(unavailable.statusCode).toBe(502);
        responses.push(unavailable.body);
        expect(
          (
            await ctx.app.inject({
              method: 'GET',
              url: '/api/auth/me',
              headers,
            })
          ).statusCode,
        ).toBe(200);
        const [user] = await db.query<Array<{ id: number }>>(
          'SELECT id FROM users WHERE empid=?',
          [empId],
        );
        const employeeCookie = await createAuthorizationSession(ctx.app, {
          kind: 'employee',
          userId: user.id,
        });
        const denied = await ctx.app.inject({
          method: 'GET',
          url: '/api/authorization/modules',
          headers: { cookie: employeeCookie },
        });
        expect(denied.statusCode).toBe(403);
        expect(denied.headers['set-cookie']).toBeUndefined();
        responses.push(denied.body);
        expect(
          (
            await ctx.app.inject({
              method: 'GET',
              url: '/api/auth/session',
              headers: { cookie: employeeCookie },
            })
          ).statusCode,
        ).toBe(200);
        const audit = await db.query<Array<Record<string, unknown>>>(
          "SELECT * FROM audit_logs WHERE action IN ('catalog.synced','role.created','role.updated','role.deleted','role.permissions_updated','user.roles_updated')",
        );
        expect(audit.length).toBeGreaterThan(0);
        const serialized = JSON.stringify({ responses, logs, audit });
        for (const secret of [
          empId,
          'AZPRIVACY-MISSING',
          cookie.split('=')[1],
          employeeCookie.split('=')[1],
          rawError,
          signature,
        ])
          expect(serialized).not.toContain(secret);
        expect(
          logs.some((entry) => JSON.stringify(entry).includes('http_access')),
        ).toBe(true);
      } finally {
        await closeSecurityE2eApp(ctx);
      }
    });
  } finally {
    await portal.drop();
    jest.restoreAllMocks();
  }
});
