import type { Job } from 'bullmq';
import { DocumentFinalizationProcessor } from '#app/worker/esign/document-finalization.processor';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { User } from '#app/features/users/entities/user.entity';
import { grantDocumentCreator } from './helpers/authorization-business-fixtures';
import { mailFixture } from './security-e2e.helper';
import { PDFDocument } from 'pdf-lib';
import { completeInitiation } from './helpers/await-initiation';
import { esignTestPng } from './esign-test-png';
import { randomUUID, createHash } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { WorkerModule } from '#app/worker.module';
import { DocumentExportProcessor } from '#app/worker/esign/document-export.processor';
import { performance } from 'node:perf_hooks';
import request from 'supertest';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
} from './security-e2e.helper';
import {
  withAuthorizationDatabase,
  initializeAuthorizationOperator,
} from './helpers/authorization-fixtures';
import { createAuthorizationSession } from './helpers/authorization-http-fixtures';

const origin = 'http://localhost:3000';
describe('028 一般匯出授權', () => {
  jest.setTimeout(120000);
  it('Super跨部門記錄Excel並顯示真匯出人，不取得本人副本資格', async () => {
    await withAuthorizationDatabase(async (db) => {
      await (await initializeAuthorizationOperator(db)).catalog.syncCatalog();
      await db.query(
        "INSERT INTO esign_documents (id,doc_number,title,status,created_by_actor_kind,created_by_user_id,created_by_department_code,sign_start_at,sign_end_at) VALUES (1,UUID(),'合成匯出文件','stopped','super_user',NULL,'A',?,?)",
        [new Date(Date.now() - 120000), new Date(Date.now() - 60000)],
      );
      const ctx = await createSecurityE2eApp(
        (b) => b.overrideProvider(MYSQL_MAIN).useValue(db),
        null,
      );
      try {
        const cookie = await createAuthorizationSession(ctx.app, {
          kind: 'super_user',
        });
        const response = await ctx.app.inject({
          method: 'POST',
          url: '/api/esign/history/export',
          headers: { cookie, origin },
          payload: {
            type: 'excel',
            documentId: '1',
            scope: '全部',
            count: 0,
            conditions: { statuses: [], depts: [], fields: ['name'] },
          },
        });
        expect(response.statusCode).toBe(201);
        const item = response.json<{
          data: { id: string; exportedBy: unknown };
        }>().data;
        expect(item.exportedBy).toEqual({
          kind: 'super_user',
          name: 'Super user',
          employeeNo: null,
          email: null,
        });
        expect(
          (
            await ctx.app.inject({
              method: 'GET',
              url: `/api/esign/history/export/${item.id}/document`,
              headers: { cookie },
            })
          ).statusCode,
        ).toBe(200);
        expect(
          (
            await ctx.app.inject({
              method: 'GET',
              url: '/api/esign/documents/1?view=export',
              headers: { cookie },
            })
          ).statusCode,
        ).toBe(200);
        expect(
          (
            await ctx.app.inject({
              method: 'POST',
              url: `/api/esign/history/export/${item.id}/downloads`,
              headers: { cookie, origin },
              payload: {},
            })
          ).statusCode,
        ).toBe(403);
      } finally {
        await closeSecurityE2eApp(ctx);
      }
    });
  });
});

it('一般匯出僅依 read/create/all，撤權後舊會話即刻拒絕，read與create不互授', async () => {
  await withAuthorizationDatabase(async (db) => {
    await (await initializeAuthorizationOperator(db)).catalog.syncCatalog();
    await db.query(
      "INSERT INTO users(id,empid,name,department_code) VALUES(1,'EXP028','合成人員','B')",
    );
    await db.query(
      "INSERT INTO esign_documents(id,doc_number,title,status,created_by_actor_kind,created_by_user_id,created_by_department_code,sign_start_at,sign_end_at) VALUES (1,UUID(),'甲文件','stopped','super_user',NULL,'A',?,?)",
      [new Date(Date.now() - 120000), new Date(Date.now() - 60000)],
    );
    await db.query(
      "INSERT INTO authorization_roles(module_key,role_code,role_name) VALUES('esign','export-test','測試匯出角色')",
    );
    const [role] = await db.query<Array<{ id: number }>>(
      "SELECT id FROM authorization_roles WHERE role_code='export-test'",
    );
    await db.query(
      "INSERT INTO authorization_user_roles(module_key,user_id,role_id) VALUES('esign',1,?)",
      [role.id],
    );
    const grant = async (keys: string[]) => {
      await db.query(
        'DELETE FROM authorization_role_permissions WHERE role_id=?',
        [role.id],
      );
      for (const key of keys)
        await db.query(
          "INSERT INTO authorization_role_permissions(module_key,role_id,permission_id) SELECT 'esign',?,id FROM authorization_permissions WHERE permission_key=?",
          [role.id, key],
        );
    };
    const ctx = await createSecurityE2eApp(
      (b) => b.overrideProvider(MYSQL_MAIN).useValue(db),
      null,
    );
    try {
      const cookie = await createAuthorizationSession(ctx.app, {
        kind: 'employee',
        userId: 1,
      });
      const get = (url: string) =>
        ctx.app.inject({ method: 'GET', url, headers: { cookie } });
      const post = (url: string, payload: object) =>
        ctx.app.inject({
          method: 'POST',
          url,
          headers: { cookie, origin },
          payload,
        });
      expect((await get('/api/esign/exportable-documents')).statusCode).toBe(
        403,
      );
      await grant(['esign.export.all']);
      expect((await get('/api/esign/exportable-documents')).statusCode).toBe(
        403,
      );
      expect(
        (
          await post('/api/esign/documents/1/export-downloads', {
            type: 'excel',
          })
        ).statusCode,
      ).toBe(403);
      await grant(['esign.export.read']);
      expect((await get('/api/esign/documents/1?view=export')).statusCode).toBe(
        404,
      );
      await grant(['esign.export.read', 'esign.export.all']);
      expect((await get('/api/esign/documents/1?view=export')).statusCode).toBe(
        200,
      );
      expect(
        (
          await post('/api/esign/documents/1/export-downloads', {
            type: 'excel',
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (await post('/api/esign/documents/1/exports', {})).statusCode,
      ).toBe(403);
      await grant(['esign.export.create', 'esign.export.all']);
      expect((await get('/api/esign/exportable-documents')).statusCode).toBe(
        403,
      );
      expect(
        (
          await post('/api/esign/documents/1/export-downloads', {
            type: 'excel',
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await post('/api/esign/documents/1/export-downloads', {
            type: 'zip',
            exportId: '00000000-0000-4000-8000-000000000000',
            fileId: '1',
          })
        ).statusCode,
      ).toBe(403);
      await grant([]);
      expect((await get('/api/esign/documents/1?view=export')).statusCode).toBe(
        403,
      );
    } finally {
      await closeSecurityE2eApp(ctx);
    }
  });
}, 120000);

it('已受理ZIP由真worker完成，保存Super提交者；撤權後poll/retry/download拒絕且pdf只給本人', async () => {
  await withAuthorizationDatabase(async (db) => {
    await (await initializeAuthorizationOperator(db)).catalog.syncCatalog();

    const user = await db.manager.save(
      User,
      db.manager.create(User, {
        empid: 'ZIP028',
        name: '合成簽署者',
        departmentCode: 'A',
        departmentName: '甲部門',
        email: 'zip028@example.test',
      }),
    );
    const ctx = await createSecurityE2eApp((b) =>
      b.overrideProvider(MYSQL_MAIN).useValue(db),
    );
    let worker: import('@nestjs/common').INestApplicationContext | undefined;
    try {
      await grantDocumentCreator(ctx.app, user.id);

      mailFixture(ctx).allowEmails(['zip028@example.test']);
      const cookie = await createAuthorizationSession(ctx.app, {
        kind: 'employee',
        userId: user.id,
      });
      const superCookie = await createAuthorizationSession(ctx.app, {
        kind: 'super_user',
      });

      const pdf = await PDFDocument.create();
      pdf.addPage();
      const upload = await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', cookie)
        .set('Origin', origin)
        .field('title', '合成ZIP文件')
        .attach('file', Buffer.from(await pdf.save()), 'source.pdf')
        .expect(201);
      const documentId = (upload.body as { data: { id: string } }).data.id;

      const initiated = await completeInitiation(
        ctx,
        request(ctx.server)
          .post(`/api/esign/documents/${documentId}/initiations`)
          .set('Cookie', cookie)
          .set('Origin', origin)
          .send({
            signers: [{ type: 'user', userId: String(user.id) }],
            fields: [
              {
                type: 'signature',
                page: 1,
                xPercent: 10,
                yPercent: 10,
                widthPercent: 20,
                heightPercent: 10,
                sortOrder: 0,
              },
            ],
            signStartAt: new Date(Date.now() - 60000).toISOString(),
            signEndAt: new Date(Date.now() + 86400000).toISOString(),
            watermark: true,
            allowReject: true,
          })
          .expect(202),
        cookie,
      );
      const signerId = (
        initiated.body as { data: { signers: Array<{ publicId: string }> } }
      ).data.signers[0].publicId;
      const task = await ctx.app.inject({
        method: 'POST',
        url: `/api/esign/signing-tasks/${signerId}`,
        headers: { cookie, origin },
      });
      const taskData = task.json<{
        data: {
          consent: { version: string };
          fields: Array<{ id: string; type: string }>;
        };
      }>().data;

      const signed = await ctx.app.inject({
        method: 'POST',
        url: `/api/esign/signing-tasks/${signerId}/signatures`,
        headers: { cookie, origin },
        payload: {
          requestId: randomUUID(),
          consentVersion: taskData.consent.version,
          accepted: true,
          signatures: taskData.fields
            .filter((f) => f.type === 'signature')
            .map((f) => ({
              fieldId: f.id,
              pngDataUrl: `data:image/png;base64,${esignTestPng(10).toString('base64')}`,
            })),
        },
      });
      expect(signed.statusCode).toBe(201);
      worker = await mailFixture(ctx)
        .install(
          Test.createTestingModule({ imports: [WorkerModule] })
            .overrideProvider(MYSQL_MAIN)
            .useValue(db),
        )
        .compile();
      await worker.init();
      const [signer] = await db.query<Array<{ id: number }>>(
        'SELECT id FROM esign_signers WHERE public_id=?',
        [signerId],
      );
      await worker.get(DocumentFinalizationProcessor).process({
        data: { documentId: Number(documentId), signerId: signer.id },
      } as Job<{ documentId: number; signerId: number }>);
      const accepted = await ctx.app.inject({
        method: 'POST',
        url: `/api/esign/documents/${documentId}/exports`,
        headers: { cookie: superCookie, origin },
        payload: { type: 'signed_copies_zip' },
      });
      expect(accepted.statusCode).toBe(202);
      const acceptedData = accepted.json<{
        data: { id: string; exportedBy: unknown };
      }>().data;
      expect(acceptedData.exportedBy).toEqual({
        kind: 'super_user',
        name: 'Super user',
        employeeNo: null,
        email: null,
      });

      const [job] = await db.query<Array<{ id: number }>>(
        'SELECT id FROM esign_export_jobs WHERE public_id=?',
        [acceptedData.id],
      );

      const start = performance.now();
      let finalData:
        | {
            status: string;
            files: Array<{ downloadPath: string; sha256: string }>;
            exportedBy: unknown;
          }
        | undefined;
      while (performance.now() - start < 30000) {
        await worker.get(DocumentExportProcessor).run(job.id);
        const state = await ctx.app.inject({
          method: 'GET',
          url: `/api/esign/documents/${documentId}/exports/${acceptedData.id}`,
          headers: { cookie: superCookie },
        });
        expect(state.statusCode).toBe(200);
        finalData = state.json<{ data: NonNullable<typeof finalData> }>().data;
        if (finalData.status === 'completed') break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(finalData?.status).toBe('completed');
      expect(finalData?.exportedBy).toEqual(acceptedData.exportedBy);
      const path = finalData!.files[0].downloadPath;
      const zip = await ctx.app.inject({
        method: 'GET',
        url: path,
        headers: { cookie: superCookie },
      });
      expect(zip.statusCode).toBe(200);
      expect(createHash('sha256').update(zip.rawPayload).digest('hex')).toBe(
        finalData!.files[0].sha256,
      );
      expect(zip.headers['content-disposition']).not.toContain('undefined');
      const ownCopy = await ctx.app.inject({
        method: 'POST',
        url: `/api/esign/signing-tasks/${signerId}/completed-file/downloads`,
        headers: { cookie, origin },
        payload: {},
      });
      expect(ownCopy.statusCode).toBe(200);
      const [copy] = await db.query<
        Array<{ public_id: string; created_by_actor_kind: string }>
      >(
        "SELECT public_id,created_by_actor_kind FROM esign_export_jobs WHERE document_id=? AND export_type='pdf'",
        [documentId],
      );
      expect(copy.created_by_actor_kind).toBe('employee');
      expect(
        (
          await ctx.app.inject({
            method: 'POST',
            url: `/api/esign/history/export/${copy.public_id}/downloads`,
            headers: { cookie: superCookie, origin },
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
      const other = await db.manager.save(
        User,
        db.manager.create(User, {
          empid: 'ZIPOTHER028',
          name: '他人',
          departmentCode: 'A',
        }),
      );
      await grantDocumentCreator(ctx.app, other.id);
      const otherCookie = await createAuthorizationSession(ctx.app, {
        kind: 'employee',
        userId: other.id,
      });
      expect(
        (
          await ctx.app.inject({
            method: 'POST',
            url: `/api/esign/history/export/${copy.public_id}/downloads`,
            headers: { cookie: otherCookie, origin },
            payload: {},
          })
        ).statusCode,
      ).toBe(404);
      await db.query(
        'UPDATE authorization_user_roles SET deleted_at=NOW(6) WHERE user_id=?',
        [user.id],
      );
      for (const url of [
        path,
        `/api/esign/documents/${documentId}/exports/${acceptedData.id}`,
      ])
        expect(
          (await ctx.app.inject({ method: 'GET', url, headers: { cookie } }))
            .statusCode,
        ).toBe(403);
      expect(
        (
          await ctx.app.inject({
            method: 'POST',
            url: `/api/esign/documents/${documentId}/exports/${acceptedData.id}/retries`,
            headers: { cookie, origin },
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
      expect(
        await db.query(
          'SELECT created_by_actor_kind,created_by_user_id FROM esign_export_jobs WHERE id=?',
          [job.id],
        ),
      ).toEqual([
        { created_by_actor_kind: 'super_user', created_by_user_id: null },
      ]);
    } finally {
      await mailFixture(ctx).cleanup(ctx.app.get(MysqlService));
      await worker?.close();
      await ctx.app.close();
    }
  });
}, 120000);
