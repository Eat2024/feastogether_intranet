import { In } from 'typeorm';
import { AuthorizationUserRole } from '#app/features/authorization/entities/authorization-user-role.entity';
import { randomBytes, randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { User } from '#app/features/users/entities/user.entity';
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
import { apiData, apiError } from './api-response.helper';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';
import { documentCreatorSessionCookie } from './helpers/authorization-business-fixtures';

describe('022 背景工作終態明細保留', () => {
  jest.setTimeout(60000);
  let ctx: SecurityE2eContext;
  let mysql: MysqlService;
  let users: User[] = [];
  let cookie: string;
  let otherCookie: string;
  let pdf: Buffer;
  const documents: string[] = [];
  const ownedJobs = new Set<number>();
  const origin = 'http://localhost:3000';
  beforeAll(async () => {
    ctx = await createSecurityE2eApp();
    mysql = ctx.app.get(MysqlService);
    const prefix = `Q${randomBytes(4).toString('hex')}`;
    users = await mysql.getManager().save(
      User,
      [0, 1].map((i) => ({
        empid: `${prefix}${i}`,
        name: '合成查詢員工',
        isActive: true,
        email: null,
        departmentCode: 'SYN022QUERY',
        departmentName: '合成查詢部門',
      })),
    );
    cookie = await session(users[0].id);
    otherCookie = await session(users[1].id);
    const source = await PDFDocument.create();
    source.addPage();
    pdf = Buffer.from(await source.save());
  });
  async function session(userId: number) {
    return await documentCreatorSessionCookie(ctx.app, userId);
  }
  async function newDoc() {
    const id = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', cookie)
        .set('Origin', origin)
        .field('title', '合成背景查詢文件')
        .attach('file', pdf, 'test.pdf')
        .expect(201),
    ).id;
    documents.push(id);
    return id;
  }
  function body(): InitiateDocumentDto {
    return {
      signers: [{ type: 'user', userId: String(users[0].id) }],
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
      signEndAt: new Date(Date.now() + 90 * 86400000).toISOString(),
      watermark: true,
      allowReject: false,
    };
  }
  async function submit(
    documentId: string,
    input = body(),
    key = randomUUID(),
  ) {
    const accepted = apiData<InitiationJobDto>(
      await request(ctx.server)
        .post(`/api/esign/documents/${documentId}/initiations`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .set('Idempotency-Key', key)
        .send(input)
        .expect(202),
    );
    const job = await mysql
      .getManager()
      .findOneByOrFail(EsignInitiationJob, { publicId: accepted.jobId });
    ownedJobs.add(job.id);
    return job;
  }
  function get(documentId: string, jobId: string, who = cookie) {
    return request(ctx.server)
      .get(`/api/esign/documents/${documentId}/initiation-jobs/${jobId}`)
      .set('Cookie', who);
  }
  async function terminal(
    doc: string,
    completedAt: Date,
    input = body(),
    key = randomUUID(),
  ) {
    const job = await submit(doc, input, key);
    await mysql.getManager().update(EsignInitiationJob, job.id, {
      status: 'failed',
      stage: 'failed',
      completedAt,
      errorCode: 'ESIGN_INITIATION_TRANSIENT_FAILURE',
      retryable: true,
      attemptCount: 3,
      issuesJson: [{ inputIndex: 0, code: 'EMPLOYEE_UNAVAILABLE' }],
      issueCount: 1,
    });
    return job;
  }
  const retentionMs = 30 * 86400000;
  async function details(job: EsignInitiationJob) {
    return mysql
      .getManager()
      .createQueryBuilder(EsignInitiationJob, 'job')
      .where('job.id=:id', { id: job.id })
      .addSelect(['job.inputJson', 'job.documentVersionJson', 'job.issuesJson'])
      .getOneOrFail();
  }
  it('終態滿30天才清理三JSON，保留全部摘要、key/hash、關聯與時間', async () => {
    const now = new Date();
    const cutoff = new Date(now.getTime() - retentionMs);
    const before = await terminal(
      await newDoc(),
      new Date(cutoff.getTime() + 1),
    );
    const boundary = await terminal(await newDoc(), cutoff);
    const older = await terminal(
      await newDoc(),
      new Date(cutoff.getTime() - 1),
    );
    await mysql
      .getManager()
      .query(
        "UPDATE esign_initiation_jobs SET updated_at='2026-09-01 01:02:03.123456' WHERE id=?",
        [boundary.id],
      );
    const original = await details(boundary);
    const summary = apiData<InitiationJobDto>(
      await get(String(boundary.documentId), boundary.publicId).expect(200),
    );
    await ctx.app.get(EsignInitiationJobService).maintain(now);
    expect((await details(before)).inputJson).not.toBeNull();
    expect(await details(boundary)).toEqual({
      ...original,
      inputJson: null,
      documentVersionJson: null,
      issuesJson: null,
      inputPurgedAt: now,
    });
    expect((await details(older)).inputJson).toBeNull();
    expect(
      await mysql
        .getManager()
        .query<
          Array<{ micros: string }>
        >("SELECT DATE_FORMAT(updated_at,'%f') AS micros FROM esign_initiation_jobs WHERE id=?", [boundary.id]),
    ).toEqual([{ micros: '123456' }]);
    expect(
      apiData<InitiationJobDto>(
        await get(String(boundary.documentId), boundary.publicId).expect(200),
      ),
    ).toEqual({ ...summary, detailsExpired: true });
    for (const suffix of ['input', 'issues']) {
      const url = `/api/esign/documents/${boundary.documentId}/initiation-jobs/${boundary.publicId}/${suffix}`;
      expect(
        apiError(
          await request(ctx.server).get(url).set('Cookie', cookie).expect(410),
        ).code,
      ).toBe('ESIGN_INITIATION_INPUT_EXPIRED');
      await request(ctx.server).get(url).set('Cookie', otherCookie).expect(404);
      await request(ctx.server).get(url).expect(401);
    }
    await ctx.app
      .get(EsignInitiationJobService)
      .maintain(new Date(now.getTime() + 1));
    expect((await details(before)).inputJson).toBeNull();
    expect(await details(boundary)).toEqual({
      ...original,
      inputJson: null,
      documentVersionJson: null,
      issuesJson: null,
      inputPurgedAt: now,
    });
  });

  it('非終態即使建立超過30天也保留輸入；到期先終態化仍保留30天', async () => {
    const now = new Date();
    const old = new Date(now.getTime() - retentionMs - 1000);
    const queued = await submit(await newDoc());
    const processing = await submit(await newDoc());
    const expired = await submit(await newDoc());
    await mysql
      .getManager()
      .update(EsignInitiationJob, queued.id, { createdAt: old });
    await mysql.getManager().update(EsignInitiationJob, processing.id, {
      createdAt: old,
      status: 'processing',
      stage: 'resolving',
      leaseToken: randomUUID(),
      leaseExpiresAt: new Date(now.getTime() + 300000),
    });
    await mysql.getManager().update(EsignInitiationJob, expired.id, {
      createdAt: old,
      acceptedAt: old,
      deadlineAt: new Date(old.getTime() + 7200000),
    });
    await ctx.app.get(EsignInitiationJobService).maintain(now);
    expect((await details(queued)).status).toBe('queued');
    expect((await details(processing)).status).toBe('processing');
    expect((await details(expired)).status).toBe('failed');
    for (const job of [queued, processing, expired]) {
      expect((await details(job)).inputJson).not.toBeNull();
      expect((await details(job)).inputPurgedAt).toBeNull();
    }
  });

  it('成功工作清理不改正式文件、指派、通知、快照或稽核證據；原發起key可重播', async () => {
    const doc = await newDoc();
    const input = body();
    const key = randomUUID();
    const job = await submit(doc, input, key);
    await ctx.app.get(EsignInitiationJobService).process(job.id);
    expect(
      apiData<InitiationJobDto>(await get(doc, job.publicId).expect(200))
        .status,
    ).toBe('succeeded');
    const evidence = async () =>
      Promise.all(
        [
          'esign_documents',
          'esign_signers',
          'esign_document_fields',
          'esign_notification_batches',
          'esign_file_objects',
        ].map((table) =>
          mysql
            .getManager()
            .query<
              unknown[]
            >(`SELECT * FROM ${table} WHERE ${table === 'esign_documents' ? 'id' : 'document_id'}=? ORDER BY id`, [doc]),
        ),
      );
    const notificationLogs = () =>
      mysql
        .getManager()
        .query<
          unknown[]
        >('SELECT l.* FROM esign_notification_logs l JOIN esign_notification_batches b ON b.id=l.batch_id WHERE b.document_id=? ORDER BY l.id', [doc]);
    const original = await evidence();
    const originalLogs = await notificationLogs();
    const now = new Date();
    await mysql.getManager().update(EsignInitiationJob, job.id, {
      completedAt: new Date(now.getTime() - retentionMs),
    });
    await ctx.app.get(EsignInitiationJobService).maintain(now);
    expect(await evidence()).toEqual(original);
    expect(await notificationLogs()).toEqual(originalLogs);
    expect((await details(job)).inputJson).toBeNull();
    const replay = apiData<InitiationJobDto>(
      await request(ctx.server)
        .post(`/api/esign/documents/${doc}/initiations`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .set('Idempotency-Key', key)
        .send(input)
        .expect(200),
    );
    expect(replay).toMatchObject({
      jobId: job.publicId,
      status: 'succeeded',
      reused: true,
      detailsExpired: true,
    });
  });

  function retry(doc: string, jobId: string, key = randomUUID()) {
    return request(ctx.server)
      .post(`/api/esign/documents/${doc}/initiation-jobs/${jobId}/retries`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', key)
      .send({});
  }
  it('清理先完成則retry明確410，不受理空名單', async () => {
    const now = new Date();
    const doc = await newDoc();
    const job = await terminal(doc, new Date(now.getTime() - retentionMs));
    await ctx.app.get(EsignInitiationJobService).maintain(now);
    expect(apiError(await retry(doc, job.publicId).expect(410)).code).toBe(
      'ESIGN_INITIATION_INPUT_EXPIRED',
    );
    expect(
      apiData<InitiationJobDto>(
        await request(ctx.server)
          .get(`/api/esign/documents/${doc}/initiation-jobs/latest`)
          .set('Cookie', cookie)
          .expect(200),
      ).jobId,
    ).toBe(job.publicId);
  });

  it('retry先受理則完整複製輸入；清理parent後仍重播同child，成功後亦同', async () => {
    const now = new Date();
    const doc = await newDoc();
    const input = body();
    const parent = await terminal(
      doc,
      new Date(now.getTime() - retentionMs),
      input,
    );
    const key = randomUUID();
    const accepted = apiData<InitiationJobDto>(
      await retry(doc, parent.publicId, key).expect(202),
    );
    const child = await mysql
      .getManager()
      .findOneByOrFail(EsignInitiationJob, { publicId: accepted.jobId });
    ownedJobs.add(child.id);
    await ctx.app.get(EsignInitiationJobService).maintain(now);
    expect((await details(parent)).inputJson).toBeNull();
    expect((await details(child)).inputJson).toEqual(input);
    expect(
      apiData<InitiationJobDto>(
        await retry(doc, parent.publicId, key).expect(200),
      ),
    ).toMatchObject({ jobId: child.publicId, status: 'queued', reused: true });
    await ctx.app.get(EsignInitiationJobService).process(child.id);
    expect(
      apiData<InitiationJobDto>(
        await retry(doc, parent.publicId, key).expect(200),
      ),
    ).toMatchObject({ jobId: child.publicId, status: 'succeeded' });
  });

  it('清理與retry並行只可能保存完整child或410；重播不再要求parent明細', async () => {
    for (let i = 0; i < 4; i++) {
      const now = new Date();
      const doc = await newDoc();
      const input = body();
      const parent = await terminal(
        doc,
        new Date(now.getTime() - retentionMs),
        input,
      );
      const key = randomUUID();
      const [response] = await Promise.all([
        retry(doc, parent.publicId, key),
        ctx.app.get(EsignInitiationJobService).maintain(now),
      ]);
      expect([202, 410]).toContain(response.status);
      if (response.status === 202) {
        const accepted = apiData<InitiationJobDto>(response);
        const child = await mysql
          .getManager()
          .findOneByOrFail(EsignInitiationJob, { publicId: accepted.jobId });
        ownedJobs.add(child.id);
        expect((await details(child)).inputJson).toEqual(input);
        await ctx.app.get(EsignInitiationJobService).maintain(now);
        expect(
          apiData<InitiationJobDto>(
            await retry(doc, parent.publicId, key).expect(200),
          ).jobId,
        ).toBe(child.publicId);
      } else {
        expect(apiError(response).code).toBe('ESIGN_INITIATION_INPUT_EXPIRED');
        expect(
          await mysql
            .getManager()
            .countBy(EsignInitiationJob, { documentId: Number(doc) }),
        ).toBe(1);
      }
    }
  });

  it('超過一批的終態全部清理；鎖住的parent略過並留待下輪', async () => {
    const now = new Date();
    const doc = await newDoc();
    const parent = await terminal(doc, new Date(now.getTime() - retentionMs));
    const original = await details(parent);
    const manager = mysql.getManager();
    const rows = await manager.save(
      EsignInitiationJob,
      Array.from({ length: 205 }, () =>
        manager.create(EsignInitiationJob, {
          documentId: parent.documentId,
          createdByUserId: parent.createdByUserId,
          publicId: randomUUID(),
          requestKey: randomUUID(),
          requestHash: parent.requestHash,
          inputJson: original.inputJson,
          documentVersionJson: original.documentVersionJson,
          issuesJson: original.issuesJson,
          status: 'failed',
          stage: 'failed',
          totalCount: 1,
          processedCount: 0,
          attemptCount: 3,
          retryable: true,
          issueCount: 1,
          acceptedAt: parent.acceptedAt,
          deadlineAt: parent.deadlineAt,
          completedAt: original.completedAt,
          errorCode: original.errorCode,
        }),
      ),
    );
    const runner = mysql.getDataSource().createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query(
        'SELECT id FROM esign_initiation_jobs WHERE id=? FOR UPDATE',
        [parent.id],
      );
      await ctx.app.get(EsignInitiationJobService).maintain(now);
      expect((await details(parent)).inputPurgedAt).toBeNull();
      const purged = await manager.query<Array<{ total: number }>>(
        'SELECT COUNT(*) AS total FROM esign_initiation_jobs WHERE document_id=? AND input_purged_at IS NOT NULL',
        [doc],
      );
      expect(Number(purged[0].total)).toBe(205);
      expect(rows).toHaveLength(205);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
    await ctx.app.get(EsignInitiationJobService).maintain(now);
    expect((await details(parent)).inputPurgedAt).toEqual(now);
  });

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
        // self FK RESTRICT：先刪子工作，再刪來源工作。
        const jobs = await tx.query<Array<{ id: number }>>(
          'SELECT id FROM esign_initiation_jobs WHERE document_id=? ORDER BY id DESC',
          [documentId],
        );
        for (const job of jobs) await tx.delete(EsignInitiationJob, job.id);
        for (const table of ['esign_file_objects', 'esign_document_fields'])
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
      await manager.delete(AuthorizationUserRole, { userId: In(ids) });
      await manager.delete(User, ids);
    }
    await closeSecurityE2eApp(ctx);
  });
});
