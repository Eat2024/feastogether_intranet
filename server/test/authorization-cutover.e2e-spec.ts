import { createHash } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { DataSource } from 'typeorm';
import { ConsoleModule } from '#app/console/console.module';
import { createAuthorizationConsole } from '#app/console/helpers/authorization.helpers';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { AuthSessionRepository } from '#app/features/auth/repositories/auth-session.repository';
import {
  withAuthorizationDatabase,
  initializeAuthorizationOperator,
} from './helpers/authorization-fixtures';
import { createAuthorizationHttpApp } from './helpers/authorization-http-fixtures';
import { createSyntheticPortal } from './synthetic-portal.helper';
import { revertAfter } from './schema-migration.helper';

jest.setTimeout(120_000);
const oldVersion = 'SuperUserAccess1793836802000';
const token = 'synthetic-existing-oauth-cookie-028'.padEnd(43, 'a');

/** 合成資料庫完整邏輯副本；排除 generated 欄位，保留 PK、FK、時間與證據 bytes。 */
async function backup(db: DataSource) {
  const tables = await db.query<Array<Record<string, string>>>('SHOW TABLES');
  return Promise.all(
    tables.map(async (entry) => {
      const table = Object.values(entry)[0];
      const columns = await db.query<Array<{ Field: string; Extra: string }>>(
        `SHOW COLUMNS FROM \`${table}\``,
      );
      const names = columns
        .filter((column) => !/(VIRTUAL|STORED) GENERATED/.test(column.Extra))
        .map((column) => column.Field);
      return {
        table,
        names,
        rows: await db.query<Array<Record<string, unknown>>>(
          `SELECT ${names.map((name) => `\`${name}\``).join(',')} FROM \`${table}\``,
        ),
      };
    }),
  );
}
async function restore(
  db: DataSource,
  snapshot: Awaited<ReturnType<typeof backup>>,
) {
  const connection = db.createQueryRunner();
  await connection.connect();
  try {
    await connection.query('SET FOREIGN_KEY_CHECKS=0');
    for (const { table, names, rows } of snapshot) {
      await connection.query(`DELETE FROM \`${table}\``);
      for (const row of rows)
        await connection.query(
          `INSERT INTO \`${table}\` (${names.map((name) => `\`${name}\``).join(',')}) VALUES (${names.map(() => '?').join(',')})`,
          names.map((name) => row[name]),
        );
    }
  } finally {
    await connection.query('SET FOREIGN_KEY_CHECKS=1');
    await connection.release();
  }
}

it('027 合成備份還原→schema up→兩次sync/核定指派，既有session免重登且歷史建立行為不升權', async () => {
  const portal = await createSyntheticPortal();
  try {
    await portal.insertPeople([
      {
        person_empid: 'AZCUT01',
        person_name: '合成核定員工',
        person_status: 1,
        department_id: 'AZCUT',
        department_name: '合成部門',
      },
    ]);
    await withAuthorizationDatabase(async (source) => {
      // 僅在空測試庫反向建出027版本，加入資料後只向前遷移。
      await revertAfter(source, oldVersion);
      await source.query(
        "INSERT INTO users(id,empid,name,department_code) VALUES(73,'AZCUT01','合成核定員工','AZCUT'),(74,'AZCUT02','合成歷史建立者','AZCUT')",
      );
      await source.query(
        "INSERT INTO esign_documents(id,doc_number,title,created_by_user_id,created_by_department_code) VALUES(81,UUID(),'合成歷史文件',74,'AZCUT')",
      );
      await source.query(
        "INSERT INTO esign_signers(id,document_id,public_id,signer_type,user_id,empid_snapshot,name_snapshot) VALUES(91,81,UUID(),'user',73,'AZCUT01','合成核定員工')",
      );
      await source.query(
        "INSERT INTO esign_signature_records(signer_id,document_sha256,signing_payload_sha256,consent_version,authentication_method,authentication_event_id,signed_at_utc) VALUES(91,?,?,'v1','employee_session','synthetic-backup-evidence',NOW(6))",
        ['a'.repeat(64), 'b'.repeat(64)],
      );
      const now = new Date();
      await new AuthSessionRepository().createActive(
        {
          actorKind: 'employee',
          userId: 73,
          source: 'oauth',
          credentialGeneration: null,
          sourceJtiHash: 'c'.repeat(64),
          sessionTokenHash: createHash('sha256').update(token).digest('hex'),
          activatedAt: now,
          expiresAt: new Date(now.getTime() + 3_600_000),
        },
        source.manager,
      );
      await initializeAuthorizationOperator(source);
      const snapshot = await backup(source);
      await withAuthorizationDatabase(async (db) => {
        await revertAfter(db, oldVersion);
        await restore(db, snapshot);
        expect(await backup(db)).toEqual(snapshot);
        const evidence = await db.query<Array<Record<string, unknown>>>(
          'SELECT * FROM esign_signature_records',
        );
        const sessions = await db.query<Array<Record<string, unknown>>>(
          'SELECT * FROM auth_sessions',
        );
        const identities = await db.query<Array<Record<string, unknown>>>(
          'SELECT id,empid,name FROM users ORDER BY id',
        );
        const signerLinks = await db.query<Array<Record<string, unknown>>>(
          'SELECT id,document_id,public_id,user_id FROM esign_signers ORDER BY id',
        );
        const documentContent = await db.query<Array<Record<string, unknown>>>(
          'SELECT id,doc_number,title,created_by_department_code FROM esign_documents ORDER BY id',
        );
        await db.runMigrations();
        expect(await db.runMigrations()).toEqual([]);
        const consoleApp = await Test.createTestingModule({
          imports: [ConsoleModule],
        })
          .overrideProvider(MYSQL_MAIN)
          .useValue(db)
          .compile();
        await consoleApp.init(); // 目錄仍空，console 必須可啟動並明確同步。
        const authz = createAuthorizationConsole(consoleApp);
        expect(await authz.syncCatalog()).toEqual({ changed: true });
        expect(await authz.syncCatalog()).toEqual({ changed: false });
        const roles = await db.query<Array<{ id: string }>>(
          "SELECT id FROM authorization_roles WHERE role_code='document_creator'",
        );
        const roleId = String(roles[0].id);
        const input = {
          empId: 'AZCUT01',
          roleIds: [roleId],
          expectedRoleIds: [],
        };
        expect((await authz.assignRoles('esign', input)).changed).toBe(true);
        expect((await authz.assignRoles('esign', input)).changed).toBe(false);
        await db.query(
          "UPDATE authorization_roles SET role_name='合成客製建立者' WHERE id=?",
          [roleId],
        );
        expect(await authz.syncCatalog()).toEqual({ changed: false });
        expect(
          await db.query(
            'SELECT role_name FROM authorization_roles WHERE id=?',
            [roleId],
          ),
        ).toEqual([{ role_name: '合成客製建立者' }]);
        const approved = await authz.userPermissions(73);
        const historical = await authz.userPermissions(74);
        expect(JSON.stringify(approved)).toContain('esign.document.create');
        expect(JSON.stringify(historical)).not.toContain(
          'esign.document.create',
        );
        expect(await db.query('SELECT * FROM esign_signature_records')).toEqual(
          evidence,
        );
        expect(await db.query('SELECT * FROM auth_sessions')).toEqual(sessions);
        expect(
          await db.query('SELECT id,empid,name FROM users ORDER BY id'),
        ).toEqual(identities);
        expect(
          await db.query(
            'SELECT id,document_id,public_id,user_id FROM esign_signers ORDER BY id',
          ),
        ).toEqual(signerLinks);
        expect(
          await db.query(
            'SELECT id,doc_number,title,created_by_department_code FROM esign_documents ORDER BY id',
          ),
        ).toEqual(documentContent);
        expect(
          await db.query(
            'SELECT id,created_by_user_id,created_by_actor_kind FROM esign_documents',
          ),
        ).toEqual([
          { id: 81, created_by_user_id: 74, created_by_actor_kind: 'employee' },
        ]);
        expect(
          await db.query(
            "SELECT COUNT(*) AS count FROM authorization_events WHERE event_type='user.roles_updated'",
          ),
        ).toEqual([{ count: 1 }]);
        const app = await createAuthorizationHttpApp(db);
        try {
          const response = await app.inject({
            method: 'GET',
            url: '/api/me/authorization',
            headers: { cookie: `FT_ESIGN_SESSION=${token}` },
          });
          expect(response.statusCode).toBe(200);
          expect(response.body).toContain('esign.document.create');
          await db.query(
            'UPDATE authorization_user_roles SET deleted_at=NOW(6) WHERE user_id=73',
          );
          const revoked = await app.inject({
            method: 'GET',
            url: '/api/me/authorization',
            headers: { cookie: `FT_ESIGN_SESSION=${token}` },
          });
          expect(revoked.statusCode).toBe(200);
          expect(revoked.body).not.toContain('esign.document.create');
          expect(revoked.headers['set-cookie']).toBeUndefined();
        } finally {
          await app.close();
          await consoleApp.close();
        }
      });
    });
  } finally {
    await portal.drop();
  }
});
