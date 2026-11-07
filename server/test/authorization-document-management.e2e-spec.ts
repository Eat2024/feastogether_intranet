import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { User } from '#app/features/users/entities/user.entity';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
} from './security-e2e.helper';
import {
  withAuthorizationDatabase,
  initializeAuthorizationOperator,
} from './helpers/authorization-fixtures';
import { createAuthorizationSession } from './helpers/authorization-http-fixtures';
import { createSyntheticPortal } from './synthetic-portal.helper';

const origin = 'http://localhost:3000';
describe('028 跨部門文件管理', () => {
  jest.setTimeout(120_000);
  it('Super 以有效部門建立真實actor文件；缺部門及假部門拒絕', async () => {
    const portal = await createSyntheticPortal();
    await portal.insertDepartments([
      { department_ch_id: 'AUTH-A', department_name: '合成甲部門' },
    ]);
    try {
      await withAuthorizationDatabase(async (db) => {
        await (await initializeAuthorizationOperator(db)).catalog.syncCatalog();
        const ctx = await createSecurityE2eApp(
          (b) => b.overrideProvider(MYSQL_MAIN).useValue(db),
          null,
        );
        try {
          const cookie = await createAuthorizationSession(ctx.app, {
            kind: 'super_user',
          });
          const pdf = await PDFDocument.create();
          pdf.addPage();
          const bytes = Buffer.from(await pdf.save());
          const upload = (department?: string) => {
            const req = request(ctx.app.getHttpServer())
              .post('/api/esign/documents')
              .set('Cookie', cookie)
              .set('Origin', origin)
              .field('title', '合成Super文件');
            if (department !== undefined)
              req.field('departmentCode', department);
            return req.attach('file', bytes, 'test.pdf');
          };
          const created = await upload('AUTH-A');
          expect(created.status).toBe(201);
          const id = (created.body as { data: { id: string } }).data.id;
          const detail = await ctx.app.inject({
            method: 'GET',
            url: `/api/esign/documents/${id}`,
            headers: { cookie },
          });
          expect(detail.statusCode).toBe(200);
          expect(
            detail.json<{ data: { createdBy: unknown } }>().data.createdBy,
          ).toEqual({
            kind: 'super_user',
            employeeNo: null,
            name: 'Super user',
          });
          expect((await upload()).status).toBe(400);
          expect((await upload('auth-a')).status).toBe(400);
          const list = await ctx.app.inject({
            method: 'GET',
            url: '/api/esign/documents',
            headers: { cookie },
          });
          expect(list.statusCode).toBe(200);
          const rows = await db.query<
            Array<{
              created_by_actor_kind: string;
              created_by_user_id: null;
              created_by_department_code: string;
            }>
          >(
            'SELECT created_by_actor_kind,created_by_user_id,created_by_department_code FROM esign_documents WHERE id=?',
            [id],
          );
          expect(rows[0]).toEqual({
            created_by_actor_kind: 'super_user',
            created_by_user_id: null,
            created_by_department_code: 'AUTH-A',
          });
        } finally {
          await closeSecurityE2eApp(ctx);
        }
      });
    } finally {
      await portal.drop();
    }
  });
});

it('明確管理能力跨部門編輯但保留原建立人，撤權後建立人只可閱讀且狀態不被繞過', async () => {
  await withAuthorizationDatabase(async (db) => {
    await (await initializeAuthorizationOperator(db)).catalog.syncCatalog();
    const ctx = await createSecurityE2eApp(
      (b) => b.overrideProvider(MYSQL_MAIN).useValue(db),
      null,
    );
    try {
      const owner = await db.manager.save(
        User,
        db.manager.create(User, {
          empid: 'DOC-OWNER',
          name: '合成建立者',
          departmentCode: 'A',
          departmentName: '合成甲部門',
        }),
      );
      const admin = await db.manager.save(
        User,
        db.manager.create(User, {
          empid: 'DOC-ADMIN',
          name: '合成管理者',
          departmentCode: 'B',
          departmentName: '合成乙部門',
        }),
      );
      const recipient = await db.manager.save(
        User,
        db.manager.create(User, {
          empid: 'DOC-SIGNER',
          name: '合成簽署人',
          departmentCode: 'C',
        }),
      );
      for (const [userId, role] of [
        [owner.id, 'document_creator'],
        [admin.id, 'esign_admin'],
      ] as const)
        await db.query(
          "INSERT INTO authorization_user_roles (module_key,user_id,role_id) SELECT 'esign',?,id FROM authorization_roles WHERE role_code=?",
          [userId, role],
        );
      const ownerCookie = await createAuthorizationSession(ctx.app, {
        kind: 'employee',
        userId: owner.id,
      });
      const adminCookie = await createAuthorizationSession(ctx.app, {
        kind: 'employee',
        userId: admin.id,
      });
      const superCookie = await createAuthorizationSession(ctx.app, {
        kind: 'super_user',
      });
      const pdf = await PDFDocument.create();
      pdf.addPage();
      const bytes = Buffer.from(await pdf.save());
      const upload = (department?: string) => {
        const req = request(ctx.app.getHttpServer())
          .post('/api/esign/documents')
          .set('Cookie', ownerCookie)
          .set('Origin', origin)
          .field('title', '原始文件');
        if (department !== undefined) req.field('departmentCode', department);
        return req.attach('file', bytes, 'test.pdf');
      };
      expect((await upload('B')).status).toBe(400);
      const created = await upload();
      expect(created.status).toBe(201);
      const id = (created.body as { data: { id: string } }).data.id;
      const path = `/api/esign/documents/${id}`;
      expect(
        (
          await ctx.app.inject({
            method: 'GET',
            url: '/api/esign/documents?role=all',
            headers: { cookie: ownerCookie },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await ctx.app.inject({
            method: 'GET',
            url: '/api/esign/documents?role=all',
            headers: { cookie: adminCookie },
          })
        ).statusCode,
      ).toBe(200);
      const detail = await ctx.app.inject({
        method: 'GET',
        url: path,
        headers: { cookie: adminCookie },
      });
      expect(detail.json<{ data: unknown }>().data).toMatchObject({
        isCreator: false,
        canManage: true,
        createdBy: {
          kind: 'employee',
          employeeNo: 'DOC-OWNER',
          name: '合成建立者',
        },
      });
      const edit = await request(ctx.app.getHttpServer())
        .patch(path)
        .set('Cookie', adminCookie)
        .set('Origin', origin)
        .field('title', '管理者更名');
      expect(edit.status).toBe(200);
      const field = {
        type: 'signature',
        page: 1,
        xPercent: 10,
        yPercent: 10,
        widthPercent: 20,
        heightPercent: 10,
        sortOrder: 0,
      };
      expect(
        (
          await ctx.app.inject({
            method: 'PUT',
            url: `${path}/fields`,
            headers: { cookie: superCookie, origin },
            payload: { fields: [field] },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await ctx.app.inject({
            method: 'PATCH',
            url: `${path}/draft-settings`,
            headers: { cookie: superCookie, origin },
            payload: {
              signers: [{ type: 'user', userId: String(recipient.id) }],
            },
          })
        ).statusCode,
      ).toBe(200);
      const [document] = await db.query<Array<Record<string, unknown>>>(
        'SELECT created_by_user_id,created_by_actor_kind,created_by_department_code,updated_by_actor_kind,updated_by_user_id FROM esign_documents WHERE id=?',
        [id],
      );
      expect(document).toEqual({
        created_by_user_id: owner.id,
        created_by_actor_kind: 'employee',
        created_by_department_code: 'A',
        updated_by_actor_kind: 'super_user',
        updated_by_user_id: null,
      });
      for (const table of ['esign_document_fields', 'esign_signers']) {
        const [row] = await db.query<Array<Record<string, unknown>>>(
          `SELECT created_by_actor_kind,created_by_user_id,updated_by_actor_kind,updated_by_user_id FROM ${table} WHERE document_id=? AND deleted_at IS NULL`,
          [id],
        );
        expect(row).toEqual({
          created_by_actor_kind: 'super_user',
          created_by_user_id: null,
          updated_by_actor_kind: 'super_user',
          updated_by_user_id: null,
        });
      }
      const [signer] = await db.query<Array<{ user_id: number }>>(
        'SELECT user_id FROM esign_signers WHERE document_id=? AND deleted_at IS NULL',
        [id],
      );
      expect(signer.user_id).toBe(recipient.id);
      await db.query(
        'UPDATE authorization_user_roles SET deleted_at=NOW(6) WHERE user_id=?',
        [owner.id],
      );
      const readonly = await ctx.app.inject({
        method: 'GET',
        url: path,
        headers: { cookie: ownerCookie },
      });
      expect(readonly.statusCode).toBe(200);
      expect(readonly.json<{ data: unknown }>().data).toMatchObject({
        isCreator: true,
        canManage: false,
      });
      expect(
        readonly.json<{ data: Record<string, unknown> }>().data,
      ).not.toHaveProperty('fields');
      await db.query(
        "UPDATE esign_documents SET status='stopped',sign_start_at=?,sign_end_at=? WHERE id=?",
        [new Date(Date.now() - 120000), new Date(Date.now() - 60000), id],
      );
      expect(
        (
          await request(ctx.app.getHttpServer())
            .patch(path)
            .set('Cookie', superCookie)
            .set('Origin', origin)
            .field('title', '不得修改')
        ).status,
      ).toBe(409);
    } finally {
      await closeSecurityE2eApp(ctx);
    }
  });
}, 120_000);

it('目前能力的 create/manage/read-all 正負矩陣，查詢部門不可升權，刪除必須重核', async () => {
  await withAuthorizationDatabase(async (db) => {
    await (await initializeAuthorizationOperator(db)).catalog.syncCatalog();
    const ctx = await createSecurityE2eApp(
      (b) => b.overrideProvider(MYSQL_MAIN).useValue(db),
      null,
    );
    try {
      const user = await db.manager.save(
        User,
        db.manager.create(User, {
          empid: 'MATRIX',
          name: '合成矩陣人員',
          departmentCode: 'B',
        }),
      );
      const cookie = await createAuthorizationSession(ctx.app, {
        kind: 'employee',
        userId: user.id,
      });
      const superCookie = await createAuthorizationSession(ctx.app, {
        kind: 'super_user',
      });
      await db.query(
        "INSERT INTO esign_documents (id,doc_number,title,created_by_actor_kind,created_by_user_id,created_by_department_code) VALUES (1,UUID(),'另一部門文件','super_user',NULL,'A')",
      );
      await db.query(
        "INSERT INTO authorization_roles (module_key,role_code,role_name) VALUES ('esign','synthetic-matrix','合成矩陣')",
      );
      const [role] = await db.query<Array<{ id: number }>>(
        "SELECT id FROM authorization_roles WHERE role_code='synthetic-matrix'",
      );
      await db.query(
        "INSERT INTO authorization_user_roles (module_key,user_id,role_id) VALUES ('esign',?,?)",
        [user.id, role.id],
      );
      const grant = async (keys: string[]) => {
        await db.query(
          'DELETE FROM authorization_role_permissions WHERE role_id=?',
          [role.id],
        );
        for (const key of keys)
          await db.query(
            "INSERT INTO authorization_role_permissions (module_key,role_id,permission_id) SELECT 'esign',?,id FROM authorization_permissions WHERE permission_key=?",
            [role.id, key],
          );
      };
      const get = (url: string) =>
        ctx.app.inject({ method: 'GET', url, headers: { cookie } });
      const edit = () =>
        request(ctx.app.getHttpServer())
          .patch('/api/esign/documents/1')
          .set('Cookie', cookie)
          .set('Origin', origin)
          .field('title', '矩陣改名');
      const pdf = await PDFDocument.create();
      pdf.addPage();
      const bytes = Buffer.from(await pdf.save());
      const create = () =>
        request(ctx.app.getHttpServer())
          .post('/api/esign/documents')
          .set('Cookie', cookie)
          .set('Origin', origin)
          .field('title', '合成建立文件')
          .attach('file', bytes, 'test.pdf');
      expect((await create()).status).toBe(403);
      expect((await get('/api/esign/documents/1')).statusCode).toBe(404);
      expect(
        (await get('/api/esign/documents?role=dep&departmentCode=A'))
          .statusCode,
      ).toBe(400);
      await grant(['esign.document.read-all']);
      expect((await get('/api/esign/documents/1')).statusCode).toBe(200);
      expect((await edit()).status).toBe(403);
      await grant(['esign.document.manage']);
      expect((await edit()).status).toBe(404);
      await grant(['esign.document.manage-all']);
      expect((await edit()).status).toBe(403);
      await grant(['esign.document.manage', 'esign.document.manage-all']);
      expect((await edit()).status).toBe(200);
      expect((await get('/api/esign/documents/1')).statusCode).toBe(404);
      await grant(['esign.document.create']);
      expect((await create()).status).toBe(201);
      expect(
        (
          await ctx.app.inject({
            method: 'DELETE',
            url: '/api/esign/documents/1',
            headers: { cookie, origin },
          })
        ).statusCode,
      ).toBe(403);
      await grant(['esign.document.manage', 'esign.document.manage-all']);
      expect(
        (
          await ctx.app.inject({
            method: 'DELETE',
            url: '/api/esign/documents/1',
            headers: { cookie, origin },
          })
        ).statusCode,
      ).toBe(204);
      expect(
        (
          await ctx.app.inject({
            method: 'GET',
            url: '/api/esign/documents/1',
            headers: { cookie: superCookie },
          })
        ).statusCode,
      ).toBe(404);
      // 尚未完成 actor 遷移的生命週期端點仍拒絕 Super。
      expect(
        (
          await ctx.app.inject({
            method: 'POST',
            url: '/api/esign/documents/1/stoppages',
            headers: { cookie: superCookie, origin },
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await closeSecurityE2eApp(ctx);
    }
  });
}, 120_000);
