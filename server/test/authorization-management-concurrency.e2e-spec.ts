import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { OauthIdentityRepository } from '#app/features/auth/repositories/oauth-identity.repository';
import { OauthIdentityService } from '#app/features/auth/services/oauth-identity.service';
import { EligibleStaffService } from '#app/features/auth/services/eligible-staff.service';
import { AuthSecurityEventService } from '#app/features/auth/services/auth-security-event.service';
import { createSyntheticPortal } from './synthetic-portal.helper';
import {
  withAuthorizationDatabase,
  initializeAuthorizationOperator,
} from './helpers/authorization-fixtures';
import {
  createAuthorizationHttpApp,
  createAuthorizationSession,
} from './helpers/authorization-http-fixtures';

jest.setTimeout(120_000);
const base = '/api/authorization/modules/esign';

it('預指派與首次登入同時建檔仍沿同一user；相競的CAS只接受一個不同目標', async () => {
  const portal = await createSyntheticPortal();
  try {
    await portal.insertPeople(
      Array.from({ length: 4 }, (_, i) => ({
        person_empid: `AZRACE${i}`,
        person_name: '合成競態員工',
        person_status: 1,
      })),
    );
    await withAuthorizationDatabase(async (db) => {
      const { catalog } = await initializeAuthorizationOperator(db);
      await catalog.syncCatalog();
      const app = await createAuthorizationHttpApp(db);
      try {
        const login = new OauthIdentityService(
          app.get(OauthIdentityRepository),
          app.get(AppLoggerService),
          app.get(MysqlService),
          app.get(EligibleStaffService),
          app.get(AuthSecurityEventService),
        );
        const cookie = await createAuthorizationSession(app, {
            kind: 'super_user',
          }),
          headers = { cookie, origin: 'http://localhost:3000' };
        for (let i = 0; i < 4; i++) {
          const empId = `AZRACE${i}`;
          const [assigned, loggedIn] = await Promise.all([
            app.inject({
              method: 'POST',
              url: `${base}/employee-role-assignments`,
              headers,
              payload: { empId, roleIds: ['2'], expectedRoleIds: [] },
            }),
            login.resolve({
              sub: `synthetic-${i}`,
              userNumber: empId,
              name: '合成登入員工',
            }),
          ]);
          expect(assigned.statusCode).toBe(200);
          expect(
            assigned.json<{ data: { userId: string } }>().data.userId,
          ).toBe(String(loggedIn.id));
          const identity = await db.query<Array<{ id: number }>>(
            'SELECT id FROM users WHERE empid=?',
            [empId],
          );
          expect(identity).toEqual([{ id: loggedIn.id }]);
        }
        const user = (
          await db.query<Array<{ id: number }>>(
            "SELECT id FROM users WHERE empid='AZRACE0'",
          )
        )[0];
        const reset = await app.inject({
          method: 'POST',
          url: `${base}/employee-role-assignments`,
          headers,
          payload: { empId: 'AZRACE0', roleIds: [], expectedRoleIds: ['2'] },
        });
        expect(reset.statusCode).toBe(200);
        const competing = await Promise.all(
          [['2'], ['3']].map((roleIds) =>
            app.inject({
              method: 'POST',
              url: `${base}/employee-role-assignments`,
              headers,
              payload: { empId: 'AZRACE0', roleIds, expectedRoleIds: [] },
            }),
          ),
        );
        expect(competing.map((r) => r.statusCode).sort()).toEqual([200, 409]);
        const winning = competing
          .find((r) => r.statusCode === 200)!
          .json<{ data: { roleIds: string[] } }>().data.roleIds;
        expect(
          (
            await app.inject({
              method: 'GET',
              url: `${base}/employees/${user.id}/roles`,
              headers,
            })
          ).json<{ data: { roleIds: string[] } }>().data.roleIds,
        ).toEqual(winning);
      } finally {
        await app.close();
      }
    });
  } finally {
    await portal.drop();
  }
});

it('角色刪除與指派競爭保持一致；audit故障時新user與既有指派都回滾', async () => {
  const portal = await createSyntheticPortal();
  try {
    await portal.insertPeople([
      {
        person_empid: 'AZDELETE',
        person_name: '合成刪除競爭',
        person_status: 1,
      },
      {
        person_empid: 'AZROLLBACK',
        person_name: '合成回滾新員工',
        person_status: 1,
      },
      {
        person_empid: 'AZEXISTING',
        person_name: '合成回滾既有員工',
        person_status: 1,
      },
    ]);
    await withAuthorizationDatabase(async (db) => {
      const { catalog } = await initializeAuthorizationOperator(db);
      await catalog.syncCatalog();
      const app = await createAuthorizationHttpApp(db);
      try {
        const cookie = await createAuthorizationSession(app, {
            kind: 'super_user',
          }),
          headers = { cookie, origin: 'http://localhost:3000' };
        const role = (
          await app.inject({
            method: 'POST',
            url: `${base}/roles`,
            headers,
            payload: { roleName: '競爭角色' },
          })
        ).json<{ data: { id: string } }>().data;
        const [assignment, deletion] = await Promise.all([
          app.inject({
            method: 'POST',
            url: `${base}/employee-role-assignments`,
            headers,
            payload: {
              empId: 'AZDELETE',
              roleIds: [role.id],
              expectedRoleIds: [],
            },
          }),
          app.inject({
            method: 'DELETE',
            url: `${base}/roles/${role.id}?expectedVersion=1`,
            headers,
          }),
        ]);
        expect([
          [200, 409],
          [404, 204],
        ]).toContainEqual([assignment.statusCode, deletion.statusCode]);
        const initial = await app.inject({
          method: 'POST',
          url: `${base}/employee-role-assignments`,
          headers,
          payload: { empId: 'AZEXISTING', roleIds: ['2'], expectedRoleIds: [] },
        });
        expect(initial.statusCode).toBe(200);
        const userId = initial.json<{ data: { userId: string } }>().data.userId;
        const eventsUrl = '/api/authorization/events?limit=100';
        const eventsBefore = (
          await app.inject({ method: 'GET', url: eventsUrl, headers })
        ).json<{ data: unknown }>().data;
        await db.query(
          "CREATE TRIGGER reject_assignment_audit BEFORE INSERT ON authorization_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='合成稽核失敗'",
        );
        for (const payload of [
          { empId: 'AZROLLBACK', roleIds: ['2'], expectedRoleIds: [] },
          { empId: 'AZEXISTING', roleIds: ['3'], expectedRoleIds: ['2'] },
        ]) {
          const response = await app.inject({
            method: 'POST',
            url: `${base}/employee-role-assignments`,
            headers,
            payload,
          });
          expect(response.statusCode).toBe(503);
          expect(response.json<{ error: { code: string } }>().error.code).toBe(
            'AUTHORIZATION_UNAVAILABLE',
          );
        }
        expect(
          await db.query("SELECT id FROM users WHERE empid='AZROLLBACK'"),
        ).toEqual([]);
        expect(
          (
            await app.inject({
              method: 'GET',
              url: `${base}/employees/${userId}/roles`,
              headers,
            })
          ).json<{ data: { roleIds: string[] } }>().data.roleIds,
        ).toEqual(['2']);
        expect(
          (await app.inject({ method: 'GET', url: eventsUrl, headers })).json<{
            data: unknown;
          }>().data,
        ).toEqual(eventsBefore);
        await db.query('DROP TRIGGER reject_assignment_audit');
      } finally {
        await app.close();
      }
    });
  } finally {
    await portal.drop();
  }
});
