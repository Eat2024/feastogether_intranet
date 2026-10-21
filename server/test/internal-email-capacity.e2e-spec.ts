import { HttpService } from '@nestjs/axios';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Observable } from 'rxjs';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { In } from 'typeorm';
import { AuthService } from '#app/features/auth/services/auth.service';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import { User } from '#app/features/users/entities/user.entity';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { ESIGN_EXTERNAL_INVITATION_QUEUE } from '#app/features/esign/esign-queue.constants';
import { HttpAccessLoggerService } from '#app/infrastructure/logging/httpEndpointLog/http-access-logger.service';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { apiData } from './api-response.helper';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

describe('Spec010 全公司 Email 容量（真實 HTTP/MySQL/Redis、合成來源）', () => {
  let ctx: SecurityE2eContext;
  let cookie: string;
  let users: User[];
  let documentId: string;
  let active = 0;
  let peak = 0;
  let batches: number[] = [];
  let failure: 'none' | 'missing' | 'source' = 'none';
  const origin = 'http://localhost:3000';
  const http = { get: jest.fn(), post: jest.fn() };
  let accessLog: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;
  const email = (empid: string) => `${empid}@capacity.example.test`;
  const post = (path: string, body: object) =>
    request(ctx.server)
      .post(path)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send(body);
  const resetSource = () => {
    active = 0;
    peak = 0;
    batches = [];
  };
  const measure = async (
    operation: string,
    count: number,
    run: () => Promise<void>,
  ) => {
    resetSource();
    const started = performance.now();
    const memory = process.memoryUsage();
    await run();
    const after = process.memoryUsage();
    // 僅彙總數據，不輸出員編、信箱、cookie 或邀請秘密；記憶體差含 GC，並非峰值。
    console.info(
      'SPEC010_CAPACITY',
      JSON.stringify({
        operation,
        count,
        elapsedMs: Math.round(performance.now() - started),
        rssDeltaMiB: Math.round((after.rss - memory.rss) / 1048576),
        heapDeltaMiB: Math.round((after.heapUsed - memory.heapUsed) / 1048576),
        batches: batches.length,
        peak,
      }),
    );
  };
  beforeAll(async () => {
    ctx = await createSecurityE2eApp((builder) =>
      builder.overrideProvider(HttpService).useValue(http),
    );
    const manager = ctx.app.get(MysqlService).getManager();
    const prefix = `C${randomBytes(4).toString('hex')}`;
    const employeeNos = Array.from(
      { length: 6000 },
      (_, i) => `${prefix}${String(i).padStart(4, '0')}`,
    );
    for (let offset = 0; offset < 6000; offset += 500)
      await manager.insert(
        User,
        employeeNos
          .slice(offset, offset + 500)
          .map((empid) => ({ empid, name: '合成容量員工', isActive: true })),
      );
    users = await manager.find(User, {
      where: { empid: In(employeeNos) },
      order: { empid: 'ASC' },
    });
    expect(users).toHaveLength(6000);
    cookie = `${AUTH_COOKIE_NAME}=${(await ctx.app.get(AuthService).issueSession(users[0].id)).token}`;
    const pdf = await PDFDocument.create();
    pdf.addPage();
    documentId = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', cookie)
        .set('Origin', origin)
        .field('title', '全公司合成容量文件')
        .attach('file', Buffer.from(await pdf.save()), {
          filename: 'capacity.pdf',
          contentType: 'application/pdf',
        })
        .expect(201),
    ).id;
    accessLog = jest.spyOn(ctx.app.get(HttpAccessLoggerService), 'write');
    warn = jest.spyOn(ctx.app.get(AppLoggerService), 'warn');
    error = jest.spyOn(ctx.app.get(AppLoggerService), 'error');
    http.post.mockImplementation(
      (
        _url: string,
        body: { person_empids: string[] },
        config: { timeout: number },
      ) => {
        expect(config.timeout).toBe(10000);
        batches.push(body.person_empids.length);
        return new Observable((subscriber) => {
          active += 1;
          peak = Math.max(peak, active);
          setImmediate(() => {
            active -= 1;
            const last = body.person_empids.includes(users[5999].empid);
            if (last && failure === 'source') {
              subscriber.error({
                isAxiosError: true,
                name: 'AxiosError',
                response: {
                  status: 503,
                  data: { email: email(users[5999].empid) },
                },
              });
              return;
            }
            subscriber.next({
              data: {
                success: true,
                data: [...body.person_empids]
                  .reverse()
                  .filter(
                    (id) =>
                      !(failure === 'missing' && id === users[5999].empid),
                  )
                  .map((person_empid) => ({
                    person_empid,
                    email: email(person_empid),
                  })),
              },
            });
            subscriber.complete();
          });
        });
      },
    );
  }, 60000);
  afterAll(async () => {
    if (!ctx) return;
    // 只移除本次文件產生的 queue jobs，不清理其他測試的 queue。
    if (documentId) {
      const manager = ctx.app.get(MysqlService).getManager();
      const logs = await ctx.app
        .get(MysqlService)
        .getManager()
        .query<
          Array<{ id: number }>
        >('SELECT l.id FROM esign_notification_logs l JOIN esign_notification_batches b ON b.id=l.batch_id WHERE b.document_id=?', [documentId]);
      const queue = ctx.app.get<Queue>(
        getQueueToken(ESIGN_EXTERNAL_INVITATION_QUEUE),
      );
      for (const log of logs) {
        const jobId = await queue.getDeduplicationJobId(`invitation-${log.id}`);
        if (jobId) await (await queue.getJob(jobId))?.remove();
      }
      const ownedLogIds = new Set(logs.map((log) => Number(log.id)));
      for (const job of await queue.getJobs([
        'waiting',
        'paused',
        'delayed',
        'failed',
        'completed',
      ])) {
        if (
          ownedLogIds.has(
            Number(
              (job.data as { notificationLogId: number }).notificationLogId,
            ),
          )
        )
          await job.remove();
      }
      // 必須同時移除本次持久通知，否則後續 worker 的 maintenance 會重新補入 6000 筆。
      const files = await manager.query<
        Array<{ object_key: string; object_version: string | null }>
      >(
        'SELECT object_key,object_version FROM esign_file_objects WHERE document_id=?',
        [documentId],
      );
      await manager.transaction(async (transaction) => {
        for (const table of [
          'esign_audit_events',
          'esign_file_objects',
          'esign_document_fields',
        ])
          await transaction.query(`DELETE FROM ${table} WHERE document_id=?`, [
            documentId,
          ]);
        await transaction.query(
          'DELETE FROM esign_notification_logs WHERE batch_id IN (SELECT id FROM esign_notification_batches WHERE document_id=?)',
          [documentId],
        );
        await transaction.query(
          'DELETE FROM esign_notification_batches WHERE document_id=?',
          [documentId],
        );
        await transaction.query(
          'DELETE FROM esign_signers WHERE document_id=?',
          [documentId],
        );
        await transaction.query('DELETE FROM esign_documents WHERE id=?', [
          documentId,
        ]);
      });
      for (const file of files)
        await ctx.app
          .get<PrivateFileStorage>(PRIVATE_FILE_STORAGE)
          .delete({
            objectKey: file.object_key,
            objectVersion: file.object_version ?? undefined,
          });
      for (let offset = 0; offset < users.length; offset += 500) {
        const ids = users.slice(offset, offset + 500).map((u) => u.id);
        await manager.query('DELETE FROM auth_sessions WHERE user_id IN (?)', [
          ids,
        ]);
        await manager.delete(User, ids);
      }
      expect(
        (await queue.getJobs(['waiting', 'paused', 'delayed', 'active'])).some(
          (job) =>
            ownedLogIds.has(
              Number(
                (job.data as { notificationLogId: number }).notificationLogId,
              ),
            ),
        ),
      ).toBe(false);
    }
    jest.restoreAllMocks();
    await closeSecurityE2eApp(ctx);
  }, 60000);

  it.each([1, 100, 101, 6000])(
    '%i 人已存在帳號解析與信箱核對保序，不誤配且批次有界',
    async (count) => {
      const selected = users.slice(0, count);
      await measure('local-resolution', count, async () => {
        const items: Array<{
          employeeNo: string;
          userId: string;
          status: string;
        }> = [];
        for (let offset = 0; offset < count; offset += 100) {
          items.push(
            ...apiData<{ items: typeof items }>(
              await post('/api/esign/signer-candidates/resolutions', {
                employeeNos: selected
                  .slice(offset, offset + 100)
                  .map((u) => u.empid),
              }).expect(200),
            ).items,
          );
        }
        expect(
          items.map((item) => [item.employeeNo, item.userId, item.status]),
        ).toEqual(selected.map((u) => [u.empid, String(u.id), 'resolved']));
        expect(http.get).not.toHaveBeenCalled();
      });
      await measure('email-check', count, async () => {
        const result = apiData<{
          items: Array<{ userId: string; status: string; maskedEmail: string }>;
        }>(
          await post(
            `/api/esign/documents/${documentId}/employee-email-checks`,
            { userIds: selected.map((u) => String(u.id)) },
          ).expect(200),
        );
        expect(result.items).toEqual(
          selected.map((u) => ({
            userId: String(u.id),
            status: 'ready',
            maskedEmail: 'c***@capacity.example.test',
          })),
        );
        expect(batches).toHaveLength(Math.ceil(count / 100));
        expect(Math.max(...batches)).toBeLessThanOrEqual(100);
        expect(peak).toBe(Math.min(4, Math.ceil(count / 100)));
        expect(active).toBe(0);
      });
    },
    60000,
  );

  const initiate = () =>
    post(`/api/esign/documents/${documentId}/initiations`, {
      signers: users.map((u) => ({ type: 'user', userId: String(u.id) })),
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
      signStartAt: new Date(Date.now() + 3600000).toISOString(),
      signEndAt: new Date(Date.now() + 86400000).toISOString(),
      watermark: false,
      allowReject: true,
    });
  it.each(['missing', 'source'] as const)(
    '6000 人末批%s失敗整份仍為草稿，無指派／通知／發起稽核',
    async (mode) => {
      failure = mode;
      await measure(`initiation-${mode}`, 6000, async () => {
        const response = await initiate().expect(
          mode === 'missing' ? 422 : 502,
        );
        if (mode === 'missing')
          expect(response.body).toMatchObject({
            error: {
              code: 'ESIGN_EMPLOYEE_EMAIL_UNAVAILABLE',
              details: { userIds: [String(users[5999].id)] },
            },
          });
        const detail = apiData<{ status: string; signers: unknown[] }>(
          await request(ctx.server)
            .get(`/api/esign/documents/${documentId}`)
            .set('Cookie', cookie)
            .expect(200),
        );
        expect(detail.status).toBe('draft');
        expect(detail.signers).toEqual([]);
        const [counts] = await ctx.app
          .get(MysqlService)
          .getManager()
          .query<
            Array<{ batches: string; initiated: string }>
          >("SELECT (SELECT COUNT(*) FROM esign_notification_batches WHERE document_id=?) batches,(SELECT COUNT(*) FROM esign_audit_events WHERE document_id=? AND event_type='document.initiated') initiated", [documentId, documentId]);
        expect(Number(counts.batches)).toBe(0);
        expect(Number(counts.initiated)).toBe(0);
        expect(batches).toHaveLength(60);
        expect(peak).toBeLessThanOrEqual(4);
      });
      failure = 'none';
    },
    60000,
  );

  it('6000 人完整發起固定信箱、快照與逐人通知，真正入列且日誌不含個資', async () => {
    await measure('initiation-success', 6000, async () => {
      const result = apiData<{
        status: string;
        signers: Array<{ type: string; email: string }>;
      }>(await initiate().expect(201));
      expect(result.status).toBe('active');
      expect(result.signers).toHaveLength(6000);
      expect(result.signers.map((s) => [s.type, s.email])).toEqual(
        users.map((u) => ['user', email(u.empid).toLowerCase()]),
      );
      expect(batches).toEqual(Array(60).fill(100));
      expect(peak).toBe(4);
      const manager = ctx.app.get(MysqlService).getManager();
      const logs = await manager.query<
        Array<{ id: number; generation: string; digest: string }>
      >(
        'SELECT l.id,l.invitation_generation_sha256 generation,s.invitation_token_sha256 digest FROM esign_notification_logs l JOIN esign_signers s ON s.id=l.signer_id WHERE s.document_id=?',
        [documentId],
      );
      expect(logs).toHaveLength(6000);
      expect(new Set(logs.map((l) => l.digest)).size).toBe(6000);
      expect(logs.every((l) => l.generation && l.generation === l.digest)).toBe(
        true,
      );
      const queue = ctx.app.get<Queue>(
        getQueueToken(ESIGN_EXTERNAL_INVITATION_QUEUE),
      );
      for (let offset = 0; offset < logs.length; offset += 100) {
        const jobs = await Promise.all(
          logs.slice(offset, offset + 100).map(async (l) => {
            const id = await queue.getDeduplicationJobId(`invitation-${l.id}`);
            return id ? queue.getJob(id) : undefined;
          }),
        );
        expect(jobs.every((job) => job !== undefined)).toBe(true);
      }
      const [document] = await manager.query<
        Array<{ signing_payload_json: string | { signers: unknown[] } }>
      >('SELECT signing_payload_json FROM esign_documents WHERE id=?', [
        documentId,
      ]);
      const payload =
        typeof document.signing_payload_json === 'string'
          ? (JSON.parse(document.signing_payload_json) as {
              signers: unknown[];
            })
          : document.signing_payload_json;
      expect(payload.signers).toHaveLength(6000);
      const audit = await manager.query<unknown[]>(
        'SELECT metadata_json FROM esign_audit_events WHERE document_id=?',
        [documentId],
      );
      const logged = JSON.stringify([
        accessLog.mock.calls,
        warn.mock.calls,
        error.mock.calls,
        audit,
      ]);
      for (const secret of [
        users[0].empid,
        email(users[0].empid).toLowerCase(),
        cookie.split('=')[1],
        logs[0].digest,
      ])
        expect(logged).not.toContain(secret);
    });
  }, 180000);
});
