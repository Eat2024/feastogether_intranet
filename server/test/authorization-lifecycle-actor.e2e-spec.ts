import { apiData } from './api-response.helper';
import type { InitiationJobDto } from '#app/features/esign/dto/initiation-job.dto';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import { WorkerModule } from '#app/worker.module';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { User } from '#app/features/users/entities/user.entity';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
  mailFixture,
} from './security-e2e.helper';
import {
  withAuthorizationDatabase,
  initializeAuthorizationOperator,
} from './helpers/authorization-fixtures';
import { createAuthorizationSession } from './helpers/authorization-http-fixtures';
import {
  driveInitiation,
  exhaustInitiationRetries,
} from './helpers/await-initiation';
import { EsignInitiationJob } from '#app/features/esign/entities/esign-initiation-job.entity';

const origin = 'http://localhost:3000';
describe('028 生命週期真實操作者', () => {
  jest.setTimeout(120_000);
  it('Super 管理他人文件，背景工作與通知保存提交者，原建立者不變', async () => {
    await withAuthorizationDatabase(async (db) => {
      await (await initializeAuthorizationOperator(db)).catalog.syncCatalog();
      const ctx = await createSecurityE2eApp(
        (b) => b.overrideProvider(MYSQL_MAIN).useValue(db),
        ['lifecycle@example.test'],
      );
      let worker: INestApplicationContext | undefined;
      try {
        const owner = await db.manager.save(
          User,
          db.manager.create(User, {
            empid: 'LIFEOWNER',
            name: '合成建立人',
            departmentCode: 'A',
            departmentName: '合成甲部門',
          }),
        );
        await db.query(
          "INSERT INTO authorization_user_roles (module_key,user_id,role_id) SELECT 'esign',?,id FROM authorization_roles WHERE role_code='document_creator'",
          [owner.id],
        );
        const ownerCookie = await createAuthorizationSession(ctx.app, {
          kind: 'employee',
          userId: owner.id,
        });
        const cookie = await createAuthorizationSession(ctx.app, {
          kind: 'super_user',
        });
        const pdf = await PDFDocument.create();
        pdf.addPage();
        const uploaded = await request(ctx.server)
          .post('/api/esign/documents')
          .set('Cookie', ownerCookie)
          .set('Origin', origin)
          .field('title', '生命週期合成文件')
          .attach('file', Buffer.from(await pdf.save()), 'test.pdf')
          .expect(201);
        const id = (uploaded.body as { data: { id: string } }).data.id;
        const accepted = await request(ctx.server)
          .post(`/api/esign/documents/${id}/initiations`)
          .set('Cookie', cookie)
          .set('Origin', origin)
          .send({
            signers: [
              {
                type: 'email',
                name: '合成簽署人',
                email: 'lifecycle@example.test',
              },
            ],
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
            signEndAt: new Date(Date.now() + 3600000).toISOString(),
            watermark: false,
            allowReject: true,
          });
        expect(accepted.status).toBe(202);
        const workerDb = await new DataSource(db.options).initialize();
        worker = await mailFixture(ctx)
          .install(
            Test.createTestingModule({ imports: [WorkerModule] })
              .overrideProvider(MYSQL_MAIN)
              .useValue(workerDb),
          )
          .compile();
        await worker.init();
        let state: { status: string };
        const started = Date.now();
        do {
          const polled = await request(ctx.server)
            .get(
              `/api/esign/documents/${id}/initiation-jobs/${apiData<InitiationJobDto>(accepted).jobId}`,
            )
            .set('Cookie', cookie)
            .expect(200);
          state = apiData<InitiationJobDto>(polled);
          if (state.status === 'succeeded' || state.status === 'failed') break;
          if (Date.now() - started > 30000)
            throw new Error('等待真 worker 逾時');
          await new Promise((resolve) => setTimeout(resolve, 30));
        } while (state.status !== 'succeeded' && state.status !== 'failed');
        expect(state).toMatchObject({
          status: 'succeeded',
          errorCode: null,
          createdBy: { kind: 'super_user', userId: null, name: 'Super user' },
        });
        expect(
          await db.query(
            'SELECT created_by_actor_kind,created_by_user_id,created_by_department_code,updated_by_actor_kind,updated_by_user_id FROM esign_documents WHERE id=?',
            [id],
          ),
        ).toEqual([
          {
            created_by_actor_kind: 'employee',
            created_by_user_id: owner.id,
            created_by_department_code: 'A',
            updated_by_actor_kind: 'super_user',
            updated_by_user_id: null,
          },
        ]);
        expect(
          await db.query(
            'SELECT notified_by_actor_kind,notified_by_user_id FROM esign_notification_batches WHERE document_id=?',
            [id],
          ),
        ).toEqual([
          { notified_by_actor_kind: 'super_user', notified_by_user_id: null },
        ]);
        const batches = await ctx.app.inject({
          method: 'GET',
          url: `/api/esign/documents/${id}/notification-batches?kind=invitation`,
          headers: { cookie },
        });
        expect(batches.statusCode).toBe(200);
        expect(
          batches.json<{ data: { items: Array<{ requestedBy: unknown }> } }>()
            .data.items[0].requestedBy,
        ).toEqual({ kind: 'super_user', userId: null, name: 'Super user' });
        expect(JSON.stringify(state)).not.toMatch(
          /inputJson|issuesJson|leaseToken|invitation|ciphertext|signature|@example/,
        );
        const signingEvidence = await db.query<Array<Record<string, unknown>>>(
          'SELECT signing_payload_json,signing_payload_sha256 FROM esign_documents WHERE id=?',
          [id],
        );
        const reminder = { requestId: randomUUID(), selection: 'all_pending' };
        const reminded = await ctx.app.inject({
          method: 'POST',
          url: `/api/esign/documents/${id}/notification-batches`,
          headers: { cookie, origin },
          payload: reminder,
        });
        expect(reminded.statusCode).toBe(202);
        expect(
          reminded.json<{ data: { requestedBy: unknown } }>().data.requestedBy,
        ).toEqual({
          kind: 'super_user',
          userId: null,
          name: 'Super user',
        });
        const replay = await ctx.app.inject({
          method: 'POST',
          url: `/api/esign/documents/${id}/notification-batches`,
          headers: { cookie, origin },
          payload: reminder,
        });
        expect(replay.json<{ data: { batchId: string } }>().data.batchId).toBe(
          reminded.json<{ data: { batchId: string } }>().data.batchId,
        );
        expect(
          (
            await ctx.app.inject({
              method: 'POST',
              url: `/api/esign/documents/${id}/notification-batches`,
              headers: { cookie, origin },
              payload: { ...reminder, requestId: randomUUID() },
            })
          ).statusCode,
        ).toBe(409);
        await worker.close();
        worker = undefined;
        const expired = new Date(Date.now() - 1000);
        await db.query('UPDATE esign_documents SET sign_end_at=? WHERE id=?', [
          expired,
          id,
        ]);
        const reopened = await ctx.app.inject({
          method: 'POST',
          url: `/api/esign/documents/${id}/reopenings`,
          headers: { cookie, origin },
          payload: {
            expectedSignEndAt: expired.toISOString(),
            signEndAt: new Date(Date.now() + 7200000).toISOString(),
            reason: '合成補簽',
          },
        });
        expect(reopened.statusCode).toBe(201);
        expect(
          (
            await ctx.app.inject({
              method: 'GET',
              url: `/api/esign/documents/${id}/reopening-invitations`,
              headers: { cookie },
            })
          ).statusCode,
        ).toBe(200);
        const stopped = await ctx.app.inject({
          method: 'POST',
          url: `/api/esign/documents/${id}/stoppages`,
          headers: { cookie, origin },
          payload: { reason: '合成停止原因' },
        });
        expect(stopped.statusCode).toBe(201);
        expect(
          await db.query(
            'SELECT signing_payload_json,signing_payload_sha256 FROM esign_documents WHERE id=?',
            [id],
          ),
        ).toEqual(signingEvidence);
        expect(
          (
            await ctx.app.inject({
              method: 'POST',
              url: `/api/esign/documents/${id}/stoppages`,
              headers: { cookie, origin },
              payload: { reason: '不得重複停止' },
            })
          ).statusCode,
        ).toBe(409);
      } finally {
        await worker?.close();
        await closeSecurityE2eApp(ctx);
      }
    });
  });
  it('跨部門管理者受理後撤權，工作仍完成，所有後續工作與生命週期存取重新拒絕', async () => {
    await withAuthorizationDatabase(async (db) => {
      await (await initializeAuthorizationOperator(db)).catalog.syncCatalog();
      const ctx = await createSecurityE2eApp(
        (b) => b.overrideProvider(MYSQL_MAIN).useValue(db),
        null,
      );
      try {
        const [owner, admin] = await db.manager.save(User, [
          db.manager.create(User, {
            empid: 'REVOKEOWNER',
            name: '合成原建立人',
            departmentCode: 'A',
          }),
          db.manager.create(User, {
            empid: 'REVOKEADMIN',
            name: '合成管理者',
            departmentCode: 'B',
          }),
        ]);
        for (const [id, role] of [
          [owner.id, 'document_creator'],
          [admin.id, 'esign_admin'],
        ])
          await db.query(
            "INSERT INTO authorization_user_roles(module_key,user_id,role_id) SELECT 'esign',?,id FROM authorization_roles WHERE role_code=?",
            [id, role],
          );
        const ownerCookie = await createAuthorizationSession(ctx.app, {
          kind: 'employee',
          userId: owner.id,
        });
        const cookie = await createAuthorizationSession(ctx.app, {
          kind: 'employee',
          userId: admin.id,
        });
        const superCookie = await createAuthorizationSession(ctx.app, {
          kind: 'super_user',
        });
        const pdf = await PDFDocument.create();
        pdf.addPage();
        const uploaded = await request(ctx.server)
          .post('/api/esign/documents')
          .set('Cookie', ownerCookie)
          .set('Origin', origin)
          .field('title', '合成撤權文件')
          .attach('file', Buffer.from(await pdf.save()), 'test.pdf')
          .expect(201);
        const id = apiData<{ id: string }>(uploaded).id;
        const accepted = await request(ctx.server)
          .post(`/api/esign/documents/${id}/initiations`)
          .set('Cookie', cookie)
          .set('Origin', origin)
          .send({
            signers: [
              {
                type: 'email',
                name: '合成簽署人',
                email: 'revocation@example.test',
              },
            ],
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
            signEndAt: new Date(Date.now() + 3600000).toISOString(),
            watermark: false,
            allowReject: true,
          })
          .expect(202);
        const jobId = apiData<InitiationJobDto>(accepted).jobId;
        expect(apiData<InitiationJobDto>(accepted).createdBy).toEqual({
          kind: 'employee',
          userId: String(admin.id),
          name: '合成管理者',
        });
        await db.query('DELETE FROM authorization_user_roles WHERE user_id=?', [
          admin.id,
        ]);
        for (const suffix of ['', '/input', '/issues'])
          expect(
            (
              await ctx.app.inject({
                method: 'GET',
                url: `/api/esign/documents/${id}/initiation-jobs/${jobId}${suffix}`,
                headers: { cookie },
              })
            ).statusCode,
          ).toBe(403);
        expect(
          (
            await ctx.app.inject({
              method: 'POST',
              url: `/api/esign/documents/${id}/initiation-jobs/${jobId}/retries`,
              headers: { cookie, origin, 'idempotency-key': randomUUID() },
              payload: {},
            })
          ).statusCode,
        ).toBe(403);
        const state = await driveInitiation(ctx, accepted, superCookie);
        expect(state).toMatchObject({
          status: 'succeeded',
          createdBy: { kind: 'employee', userId: String(admin.id) },
        });
        const persisted = await db.manager.findOneByOrFail(EsignInitiationJob, {
          publicId: jobId,
        });
        expect(persisted.createdByUserId).toBe(admin.id);
        expect(
          await db.query(
            'SELECT created_by_user_id,created_by_department_code,updated_by_user_id FROM esign_documents WHERE id=?',
            [id],
          ),
        ).toEqual([
          {
            created_by_user_id: owner.id,
            created_by_department_code: 'A',
            updated_by_user_id: admin.id,
          },
        ]);
        for (const suffix of ['notification-batches', 'reopening-invitations'])
          expect(
            (
              await ctx.app.inject({
                method: 'GET',
                url: `/api/esign/documents/${id}/${suffix}`,
                headers: { cookie },
              })
            ).statusCode,
          ).toBe(403);
        for (const suffix of [
          'stoppages',
          'reopenings',
          'notification-batches',
        ])
          expect(
            (
              await ctx.app.inject({
                method: 'POST',
                url: `/api/esign/documents/${id}/${suffix}`,
                headers: { cookie, origin },
                payload: {},
              })
            ).statusCode,
          ).toBe(403);
        // 重新取得一般建立人能力仍不等於其他人的管理範圍。
        await db.query(
          "INSERT INTO authorization_user_roles(module_key,user_id,role_id) SELECT 'esign',?,id FROM authorization_roles WHERE role_code='document_creator'",
          [admin.id],
        );
        expect(
          (
            await ctx.app.inject({
              method: 'GET',
              url: `/api/esign/documents/${id}/initiation-jobs/${jobId}`,
              headers: { cookie },
            })
          ).statusCode,
        ).toBe(404);
        expect(
          (
            await ctx.app.inject({
              method: 'GET',
              url: `/api/esign/documents/${id}/notification-batches`,
              headers: { cookie },
            })
          ).statusCode,
        ).toBe(404);
      } finally {
        await closeSecurityE2eApp(ctx);
      }
    });
  });

  it('同 job 暫時失敗重試保留原 actor，人工新 job 記錄新提交者且重播不改 actor', async () => {
    await withAuthorizationDatabase(async (db) => {
      await (await initializeAuthorizationOperator(db)).catalog.syncCatalog();
      const ctx = await createSecurityE2eApp(
        (b) => b.overrideProvider(MYSQL_MAIN).useValue(db),
        null,
      );
      try {
        const [owner, admin] = await db.manager.save(User, [
          db.manager.create(User, {
            empid: 'RETRYOWNER',
            name: '合成原建立人',
            departmentCode: 'A',
          }),
          db.manager.create(User, {
            empid: 'RETRYADMIN',
            name: '合成管理者',
            departmentCode: 'B',
          }),
        ]);
        for (const [id, role] of [
          [owner.id, 'document_creator'],
          [admin.id, 'esign_admin'],
        ])
          await db.query(
            "INSERT INTO authorization_user_roles(module_key,user_id,role_id) SELECT 'esign',?,id FROM authorization_roles WHERE role_code=?",
            [id, role],
          );
        const ownerCookie = await createAuthorizationSession(ctx.app, {
          kind: 'employee',
          userId: owner.id,
        });
        const cookie = await createAuthorizationSession(ctx.app, {
          kind: 'employee',
          userId: admin.id,
        });
        const superCookie = await createAuthorizationSession(ctx.app, {
          kind: 'super_user',
        });
        const pdf = await PDFDocument.create();
        pdf.addPage();
        const uploaded = await request(ctx.server)
          .post('/api/esign/documents')
          .set('Cookie', ownerCookie)
          .set('Origin', origin)
          .field('title', '合成撤權文件')
          .attach('file', Buffer.from(await pdf.save()), 'test.pdf')
          .expect(201);
        const id = apiData<{ id: string }>(uploaded).id;
        const accepted = await request(ctx.server)
          .post(`/api/esign/documents/${id}/initiations`)
          .set('Cookie', cookie)
          .set('Origin', origin)
          .send({
            signers: [
              {
                type: 'email',
                name: '合成簽署人',
                email: 'revocation@example.test',
              },
            ],
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
            signEndAt: new Date(Date.now() + 3600000).toISOString(),
            watermark: false,
            allowReject: true,
          })
          .expect(202);
        const jobId = apiData<InitiationJobDto>(accepted).jobId;

        const fault = jest
          .spyOn(ctx.app.get(UserRepository), 'findByIds')
          .mockRejectedValue(
            Object.assign(new Error('合成資料庫邊界暫時故障'), {
              code: 'ECONNRESET',
            }),
          );
        const failed = await exhaustInitiationRetries(ctx, accepted, cookie);
        fault.mockRestore();
        expect(failed).toMatchObject({
          attemptCount: 3,
          retryable: true,
          createdBy: { kind: 'employee', userId: String(admin.id) },
        });
        const key = randomUUID();
        const retry = await request(ctx.server)
          .post(`/api/esign/documents/${id}/initiation-jobs/${jobId}/retries`)
          .set('Cookie', superCookie)
          .set('Origin', origin)
          .set('Idempotency-Key', key)
          .send({})
          .expect(202);
        expect(apiData<InitiationJobDto>(retry).createdBy).toEqual({
          kind: 'super_user',
          userId: null,
          name: 'Super user',
        });
        const replay = await request(ctx.server)
          .post(`/api/esign/documents/${id}/initiation-jobs/${jobId}/retries`)
          .set('Cookie', cookie)
          .set('Origin', origin)
          .set('Idempotency-Key', key)
          .send({})
          .expect(200);
        expect(apiData<InitiationJobDto>(replay)).toMatchObject({
          jobId: apiData<InitiationJobDto>(retry).jobId,
          reused: true,
          createdBy: { kind: 'super_user', userId: null },
        });
        const state = await driveInitiation(ctx, retry, superCookie);
        expect(state).toMatchObject({
          status: 'succeeded',
          createdBy: { kind: 'super_user', userId: null },
        });
        expect(
          await db.query(
            'SELECT created_by_actor_kind,created_by_user_id FROM esign_initiation_jobs ORDER BY id',
          ),
        ).toEqual([
          { created_by_actor_kind: 'employee', created_by_user_id: admin.id },
          { created_by_actor_kind: 'super_user', created_by_user_id: null },
        ]);
      } finally {
        jest.restoreAllMocks();
        await closeSecurityE2eApp(ctx);
      }
    });
  });
});
