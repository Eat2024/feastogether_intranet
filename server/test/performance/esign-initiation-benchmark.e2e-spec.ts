import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { getQueueToken } from '@nestjs/bullmq';
import { Worker, type Queue } from 'bullmq';
import { DataSource, In } from 'typeorm';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { User } from '#app/features/users/entities/user.entity';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { EsignInitiationJobService } from '#app/features/esign/services/esign-initiation-job.service';
import { EsignInitiationJob } from '#app/features/esign/entities/esign-initiation-job.entity';
import type { InitiateDocumentDto } from '#app/features/esign/dto/initiation.dto';
import type { InitiationJobDto } from '#app/features/esign/dto/initiation-job.dto';
import {
  ESIGN_DOCUMENT_INITIATION_QUEUE,
  ESIGN_EXTERNAL_INVITATION_QUEUE,
} from '#app/features/esign/esign-queue.constants';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { apiData } from '../api-response.helper';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
  type SecurityE2eContext,
} from '../security-e2e.helper';
import { employeeSessionCookie } from '../employee-session.helper';

/** 明確 opt-in 的本機合成效能驗收，不登記一般 e2e suite。 */
describe('022 發起實時間效能驗收', () => {
  jest.setTimeout(300000);
  let ctx: SecurityE2eContext;
  let mysql: MysqlService;
  let users: User[] = [];
  let cookie: string;
  let pdf: Buffer;
  const documents: string[] = [];
  const ownedJobs = new Set<number>();
  const origin = 'http://localhost:3000';
  beforeAll(async () => {
    ctx = await createSecurityE2eApp();
    mysql = ctx.app.get(MysqlService);
    const prefix = `BG${randomBytes(4).toString('hex')}`;
    const empids = Array.from(
      { length: 6001 },
      (_, i) => `${prefix}${String(i).padStart(4, '0')}`,
    );
    for (let i = 0; i < empids.length; i += 500)
      await mysql.getManager().insert(
        User,
        empids.slice(i, i + 500).map((empid) => ({
          empid,
          name: '合成背景員工',
          isActive: true,
          email: null,
          departmentCode: 'SYN022CAP',
          departmentName: '合成部門',
        })),
      );
    users = await mysql
      .getManager()
      .find(User, { where: { empid: In(empids) }, order: { empid: 'ASC' } });
    cookie = await employeeSessionCookie(ctx.app, users[0].id);
    const source = await PDFDocument.create();
    source.addPage();
    pdf = Buffer.from(await source.save());
  });
  async function submit(
    signers: InitiateDocumentDto['signers'],
    beforeAccept?: () => Promise<void>,
  ) {
    const documentId = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', cookie)
        .set('Origin', origin)
        .field('title', '合成背景容量文件')
        .attach('file', pdf, 'test.pdf')
        .expect(201),
    ).id;
    documents.push(documentId);
    const body: InitiateDocumentDto = {
      signers,
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
      allowReject: false,
    };
    await beforeAccept?.();
    const acceptanceStart = performance.now();
    const accepted = apiData<InitiationJobDto>(
      await request(ctx.server)
        .post(`/api/esign/documents/${documentId}/initiations`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send(body)
        .expect(202),
    );
    expect(accepted).toMatchObject({
      status: 'queued',
      totalCount: signers.length,
      processedCount: 0,
    });
    const acceptedMs = performance.now() - acceptanceStart;
    const job = await mysql
      .getManager()
      .findOneByOrFail(EsignInitiationJob, { publicId: accepted.jobId });
    ownedJobs.add(job.id);
    return { documentId, job, acceptedMs };
  }
  async function summary(documentId: string, jobId: string) {
    return apiData<InitiationJobDto>(
      await request(ctx.server)
        .get(`/api/esign/documents/${documentId}/initiation-jobs/${jobId}`)
        .set('Cookie', cookie)
        .expect(200),
    );
  }
  async function detail(documentId: string) {
    return apiData<{
      status: string;
      signers: Array<{ id: string; employeeNo: string; sortOrder: number }>;
    }>(
      await request(ctx.server)
        .get(`/api/esign/documents/${documentId}`)
        .set('Cookie', cookie)
        .expect(200),
    );
  }

  async function worker() {
    const queue = ctx.app.get<Queue>(
      getQueueToken(ESIGN_DOCUMENT_INITIATION_QUEUE),
    );
    await queue.setGlobalConcurrency(1);
    const consumer = new Worker<{ jobId: number }>(
      ESIGN_DOCUMENT_INITIATION_QUEUE,
      async (job) =>
        ctx.app.get(EsignInitiationJobService).process(job.data.jobId),
      {
        connection: {
          host: '127.0.0.1',
          port: 16322,
          db: Number(process.env.REDIS_DB),
        },
        concurrency: 1,
      },
    );
    await consumer.waitUntilReady();
    return consumer;
  }
  const wait = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));
  async function terminal(id: number, timeoutMs = 60000) {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      const row = await mysql
        .getManager()
        .findOneByOrFail(EsignInitiationJob, { id });
      if (row.status === 'succeeded' || row.status === 'failed') return row;
      await wait(100);
    }
    throw new Error('背景發起驗收等待逾時');
  }
  it('SC-001/002 80 次受理與完整名單', async () => {
    const measurements: Array<{
      count: number;
      acceptedMs: number;
      processingMs: number;
      rssBytes: number;
    }> = [];
    for (const count of [1, 100, 101, 5001]) {
      for (let round = 0; round < 20; round++) {
        const { job, documentId, acceptedMs } = await submit(
          users
            .slice(0, count)
            .map((u) => ({ type: 'user', userId: String(u.id) })),
        );
        const started = performance.now();
        await ctx.app.get(EsignInitiationJobService).process(job.id);
        expect((await summary(documentId, job.publicId)).status).toBe(
          'succeeded',
        );
        expect((await detail(documentId)).signers).toHaveLength(count);
        measurements.push({
          count,
          acceptedMs,
          processingMs: performance.now() - started,
          rssBytes: process.memoryUsage().rss,
        });
      }
    }
    const result = [1, 100, 101, 5001].map((count) => {
      const group = measurements.filter((m) => m.count === count);
      const accepted = group.map((m) => m.acceptedMs).sort((a, b) => a - b);
      return {
        count,
        samples: group.length,
        acceptedP50Ms: accepted[9],
        acceptedP95Ms: accepted[18],
        processingMaxMs: Math.max(...group.map((m) => m.processingMs)),
        rssMaxBytes: Math.max(...group.map((m) => m.rssBytes)),
      };
    });
    writeFileSync(
      '/tmp/022-acceptance-benchmark.json',
      JSON.stringify(
        { environment: 'local synthetic MySQL8.4 Redis7', result },
        null,
        2,
      ),
    );
    for (const row of result)
      expect(row.acceptedP95Ms).toBeLessThanOrEqual(3000);
  });
  it('SC-008 大型後小型排隊', async () => {
    const large = await submit(
      users.slice(0, 5001).map((u) => ({ type: 'user', userId: String(u.id) })),
    );
    const small = await submit(
      users.slice(0, 5).map((u) => ({ type: 'user', userId: String(u.id) })),
    );
    const consumer = await worker();
    try {
      const largeDone = await terminal(large.job.id);
      const smallDone = await terminal(small.job.id);
      expect(largeDone.status).toBe('succeeded');
      expect(smallDone.status).toBe('succeeded');
      expect(smallDone.startedAt!.getTime()).toBeGreaterThanOrEqual(
        largeDone.completedAt!.getTime(),
      );
      const waitingAfterLargeMs =
        smallDone.startedAt!.getTime() - largeDone.completedAt!.getTime();
      expect(waitingAfterLargeMs).toBeLessThanOrEqual(60000);
      writeFileSync(
        '/tmp/022-mixed-benchmark.json',
        JSON.stringify(
          {
            largeAcceptedMs: large.acceptedMs,
            smallAcceptedMs: small.acceptedMs,
            waitingAfterLargeMs,
          },
          null,
          2,
        ),
      );
    } finally {
      await consumer.close();
    }
  });
  it('review 同建立人另一份文件受理等待users列鎖', async () => {
    const blocker = await new DataSource(
      mysql.getDataSource().options,
    ).initialize();
    const runner = blocker.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let unlock: Promise<void> | undefined;
    let releasedAt: string | undefined;
    try {
      const result = await submit(
        [{ type: 'user', userId: String(users[0].id) }],
        async () => {
          await runner.query('SELECT id FROM users WHERE id=? FOR UPDATE', [
            users[0].id,
          ]);
          unlock = wait(5000).then(async () => {
            await runner.commitTransaction();
            releasedAt = new Date().toISOString();
          });
        },
      );
      await unlock;
      expect(result.acceptedMs).toBeGreaterThanOrEqual(4500);
      await ctx.app.get(EsignInitiationJobService).process(result.job.id);
      expect(
        (await summary(result.documentId, result.job.publicId)).status,
      ).toBe('succeeded');
      writeFileSync(
        '/tmp/022-creator-lock-benchmark.json',
        JSON.stringify(
          {
            heldMilliseconds: 5000,
            acceptedMs: result.acceptedMs,
            releasedAt,
            httpStatus: 202,
            status: 'succeeded',
            scope:
              '獨立連線持有同建立人users列，模擬另一份文件正式交易；未改正式pool或鎖順序',
          },
          null,
          2,
        ),
      );
    } finally {
      await unlock;
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await blocker.destroy();
    }
  });

  it('SC-006 真實5001秒逐人首次查核延遲', async () => {
    if (
      process.env.DB_MYSQL_DB !== 'feastogether_intranet_test022_long' ||
      process.env.REDIS_DB !== '10'
    )
      throw new Error('長測僅允許專用 test022_long / Redis DB10');
    const selected = users.slice(0, 5001);
    const selectedIds = new Set(selected.map((u) => String(u.id)));
    const delayed = new Set<string>();
    const repo = ctx.app.get(UserRepository);
    const original = new UserRepository();
    const injected = jest
      .spyOn(repo, 'findByIds')
      .mockImplementation(async (...args) => {
        const first = args[0]
          .map(String)
          .filter((id) => selectedIds.has(id) && !delayed.has(id));
        first.forEach((id) => delayed.add(id));
        if (first.length) await wait(first.length * 1000);
        return original.findByIds(...args);
      });
    const started = performance.now();
    const startedAt = new Date().toISOString();
    const { job, documentId, acceptedMs } = await submit(
      selected.map((u) => ({ type: 'user', userId: String(u.id) })),
    );
    const update = async () => {
      const row = await mysql
        .getManager()
        .findOneByOrFail(EsignInitiationJob, { id: job.id });
      writeFileSync(
        '/tmp/022-long-benchmark-progress.json',
        JSON.stringify(
          {
            startedAt,
            updatedAt: new Date().toISOString(),
            elapsedSeconds: (performance.now() - started) / 1000,
            processed: row.processedCount,
            total: row.totalCount,
            lastHeartbeat: row.lastProgressAt,
            status: row.status,
            stage: row.stage,
            attemptCount: row.attemptCount,
            errorCode: row.errorCode,
            acceptedMs,
          },
          null,
          2,
        ),
      );
    };
    await update();
    let updating = false;
    const timer = setInterval(() => {
      if (updating) return;
      updating = true;
      void update()
        .catch(() => {
          writeFileSync(
            '/tmp/022-long-benchmark-progress-error.json',
            JSON.stringify({
              updatedAt: new Date().toISOString(),
              error: 'PROGRESS_READ_FAILED',
            }),
          );
        })
        .finally(() => {
          updating = false;
        });
    }, 30000);
    const consumer = await worker();
    try {
      const done = await terminal(job.id, 7200000);
      await update();
      expect(done.status).toBe('succeeded');
      expect(done.attemptCount).toBe(1);
      expect(delayed.size).toBe(5001);
      expect((await detail(documentId)).signers).toHaveLength(5001);
      const elapsedSeconds = (performance.now() - started) / 1000;
      expect(elapsedSeconds).toBeGreaterThanOrEqual(5001);
      expect(elapsedSeconds).toBeLessThan(7200);
      writeFileSync(
        '/tmp/022-long-benchmark-result.json',
        JSON.stringify(
          {
            startedAt,
            completedAt: new Date().toISOString(),
            elapsedSeconds,
            delayedPeople: delayed.size,
            acceptedMs,
            status: done.status,
            attemptCount: done.attemptCount,
          },
          null,
          2,
        ),
      );
    } finally {
      clearInterval(timer);
      await consumer.close();
      injected.mockRestore();
      await update();
    }
  }, 7300000);
  afterAll(async () => {
    jest.restoreAllMocks();
    if (!ctx) return;
    const manager = mysql.getManager();
    const batchIds = new Set<number>();
    const logIds = new Set<number>();
    for (const documentId of documents) {
      const batches = await manager.query<Array<{ id: number }>>(
        'SELECT id FROM esign_notification_batches WHERE document_id=?',
        [documentId],
      );
      batches.forEach((b) => batchIds.add(Number(b.id)));
      const logs = await manager.query<Array<{ id: number }>>(
        'SELECT l.id FROM esign_notification_logs l JOIN esign_notification_batches b ON b.id=l.batch_id WHERE b.document_id=?',
        [documentId],
      );
      logs.forEach((l) => logIds.add(Number(l.id)));
    }
    for (const name of [
      ESIGN_DOCUMENT_INITIATION_QUEUE,
      ESIGN_EXTERNAL_INVITATION_QUEUE,
    ]) {
      const queue = ctx.app.get<Queue>(getQueueToken(name));
      for (const job of await queue.getJobs([
        'waiting',
        'paused',
        'delayed',
        'failed',
        'completed',
      ])) {
        const payload = job.data as {
          jobId?: number;
          notificationLogId?: number;
          notificationBatchId?: number;
        };
        if (
          (name === ESIGN_DOCUMENT_INITIATION_QUEUE &&
            ownedJobs.has(Number(payload.jobId))) ||
          (name === ESIGN_EXTERNAL_INVITATION_QUEUE &&
            (batchIds.has(Number(payload.notificationBatchId)) ||
              logIds.has(Number(payload.notificationLogId))))
        )
          await job.remove();
      }
    }
    for (const documentId of documents) {
      const files = await manager.query<
        Array<{ object_key: string; object_version: string | null }>
      >(
        'SELECT object_key,object_version FROM esign_file_objects WHERE document_id=?',
        [documentId],
      );
      await manager.transaction(async (tx) => {
        for (const table of [
          'esign_initiation_jobs',
          'esign_file_objects',
          'esign_document_fields',
        ])
          await tx.query(`DELETE FROM ${table} WHERE document_id=?`, [
            documentId,
          ]);
        await tx.query(
          'DELETE FROM esign_notification_logs WHERE batch_id IN (SELECT id FROM esign_notification_batches WHERE document_id=?)',
          [documentId],
        );
        await tx.query(
          'DELETE FROM esign_notification_batches WHERE document_id=?',
          [documentId],
        );
        await tx.query('DELETE FROM esign_signers WHERE document_id=?', [
          documentId,
        ]);
        await tx.query('DELETE FROM esign_documents WHERE id=?', [documentId]);
      });
      for (const file of files)
        await ctx.app.get<PrivateFileStorage>(PRIVATE_FILE_STORAGE).delete({
          objectKey: file.object_key,
          objectVersion: file.object_version ?? undefined,
        });
    }
    for (let i = 0; i < users.length; i += 500) {
      const ids = users.slice(i, i + 500).map((u) => u.id);
      await manager.query('DELETE FROM auth_sessions WHERE user_id IN (?)', [
        ids,
      ]);
      await manager.delete(User, ids);
    }
    await closeSecurityE2eApp(ctx);
  });
});
