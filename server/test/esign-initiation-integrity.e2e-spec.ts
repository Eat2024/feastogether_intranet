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
import { employeeSessionCookie } from './employee-session.helper';

describe('022 草稿版本完整性', () => {
  jest.setTimeout(60000);
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
    const source = await PDFDocument.create();
    source.addPage();
    pdf = Buffer.from(await source.save());
  });
  async function session(userId: number) {
    return await employeeSessionCookie(ctx.app, userId);
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
      signEndAt: new Date(Date.now() + 86400000).toISOString(),
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
  async function retryable(doc: string) {
    const job = await submit(doc);
    await mysql.getManager().update(EsignInitiationJob, job.id, {
      status: 'failed',
      stage: 'failed',
      completedAt: new Date(),
      errorCode: 'ESIGN_INITIATION_TRANSIENT_FAILURE',
      retryable: true,
      attemptCount: 3,
    });
    return job;
  }
  function retry(doc: string, job: EsignInitiationJob) {
    return request(ctx.server)
      .post(
        `/api/esign/documents/${doc}/initiation-jobs/${job.publicId}/retries`,
      )
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({});
  }
  async function version(doc: string) {
    const rows = await mysql
      .getManager()
      .query<
        Array<{ version: string }>
      >("SELECT DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s.%f') AS version FROM esign_documents WHERE id=?", [doc]);
    return rows[0].version;
  }
  it('failed後合法PUT fields異動會讓舊retry失效，不覆蓋新欄位', async () => {
    const doc = await newDoc();
    const parent = await retryable(doc);
    const before = await version(doc);
    await request(ctx.server)
      .put(`/api/esign/documents/${doc}/fields`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({ fields: [{ ...body().fields[0], xPercent: 35 }] })
      .expect(200);
    expect(apiError(await retry(doc, parent).expect(409)).code).toBe(
      'ESIGN_INITIATION_DOCUMENT_CHANGED',
    );
    expect(await version(doc)).not.toBe(before);
  });

  async function settings(doc: string, payload: unknown) {
    return request(ctx.server)
      .patch(`/api/esign/documents/${doc}/draft-settings`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send(payload)
      .expect(200);
  }
  async function edit(doc: string, kind: string) {
    const base = request(ctx.server);
    if (kind === 'draftSave')
      return base
        .put(`/api/esign/documents/${doc}/draftSave`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send({ signers: [{ type: 'user', userId: String(users[1].id) }] })
        .expect(200);
    if (kind === 'signers')
      return settings(doc, {
        signers: [{ type: 'user', userId: String(users[1].id) }],
      });
    if (kind === 'period')
      return settings(doc, {
        signEndAt: new Date(Date.now() + 172800000).toISOString(),
      });
    if (kind === 'options')
      return settings(doc, { watermark: false, allowReject: true });
    if (kind === 'note') {
      const detail = apiData<{ signers: { publicId: string }[] }>(
        await base
          .get(`/api/esign/documents/${doc}`)
          .set('Cookie', cookie)
          .expect(200),
      );
      return request(ctx.server)
        .patch(
          `/api/esign/documents/${doc}/signers/${detail.signers[0].publicId}/note`,
        )
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send({ note: '合成新註記' })
        .expect(200);
    }
    const update = base
      .patch(`/api/esign/documents/${doc}`)
      .set('Cookie', cookie)
      .set('Origin', origin);
    if (kind === 'fields')
      return update
        .field(
          'fields',
          JSON.stringify([{ ...body().fields[0], xPercent: 35 }]),
        )
        .expect(200);
    if (kind === 'pdf')
      return update.attach('file', pdf, 'replacement.pdf').expect(200);
    return update.field('title', '合成修改標題').expect(200);
  }
  it.each([
    'draftSave',
    'signers',
    'period',
    'options',
    'note',
    'fields',
    'pdf',
    'title',
  ])('failed後%s異動推進版本並拒絕舊retry', async (kind) => {
    const doc = await newDoc();
    const input = body();
    await settings(doc, {
      signers: input.signers,
      signStartAt: input.signStartAt,
      signEndAt: input.signEndAt,
      watermark: true,
      allowReject: false,
    });
    const parent = await retryable(doc);
    const before = await version(doc);
    await edit(doc, kind);
    expect(apiError(await retry(doc, parent).expect(409)).code).toBe(
      'ESIGN_INITIATION_DOCUMENT_CHANGED',
    );
    expect((await version(doc)) > before).toBe(true);
  });
  async function databaseClock(timestamp: number) {
    // 系統時鐘 seam：只控制此隔離 app 的 MySQL pool sessions，不改全域資料庫時鐘。
    const runners = Array.from(
      { length: Number(process.env.DB_MYSQL_POOL_MAX ?? '10') },
      () => mysql.getDataSource().createQueryRunner(),
    );
    try {
      await Promise.all(runners.map((r) => r.connect()));
      await Promise.all(
        runners.map((r) => r.query('SET timestamp = ?', [timestamp])),
      );
    } finally {
      await Promise.all(runners.map((r) => r.release()));
    }
  }
  it('同秒dirty與no-dirty連續儲存都單調推進；不受ORM整秒回退影響', async () => {
    await databaseClock(Math.floor(Date.now() / 1000) + 60);
    try {
      const doc = await newDoc();
      await edit(doc, 'title');
      const parent = await retryable(doc);
      const before = await version(doc);
      await request(ctx.server)
        .patch(`/api/esign/documents/${doc}`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .field('title', '第二次同秒標題')
        .expect(200);
      const after = await version(doc);
      expect(after.slice(0, 19)).toBe(before.slice(0, 19));
      expect(after > before).toBe(true);
      await request(ctx.server)
        .patch(`/api/esign/documents/${doc}`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .field('title', '第二次同秒標題')
        .expect(200);
      const same = await version(doc);
      expect(same.slice(0, 19)).toBe(after.slice(0, 19));
      expect(same > after).toBe(true);
      expect(apiError(await retry(doc, parent).expect(409)).code).toBe(
        'ESIGN_INITIATION_DOCUMENT_CHANGED',
      );
    } finally {
      await databaseClock(0);
    }
  });

  it('被busy或無效內容拒絕的修改不推進版本；正式worker不自我衝突', async () => {
    const doc = await newDoc();
    const job = await submit(doc);
    const before = await version(doc);
    await request(ctx.server)
      .put(`/api/esign/documents/${doc}/fields`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({ fields: body().fields })
      .expect(409);
    expect(await version(doc)).toBe(before);
    await ctx.app.get(EsignInitiationJobService).process(job.id);
    expect(
      apiData<InitiationJobDto>(await get(doc, job.publicId).expect(200))
        .status,
    ).toBe('succeeded');
    const activeVersion = await version(doc);
    await edit(doc, 'note');
    expect(await version(doc)).toBe(activeVersion);
    const draft = await newDoc();
    const previous = await version(draft);
    await request(ctx.server)
      .patch(`/api/esign/documents/${draft}`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .field('title', '不應保存的名稱')
      .field('fields', JSON.stringify([{ ...body().fields[0], page: 999 }]))
      .expect(400);
    expect(await version(draft)).toBe(previous);
    expect(
      apiData<{ title: string }>(
        await request(ctx.server)
          .get(`/api/esign/documents/${draft}`)
          .set('Cookie', cookie)
          .expect(200),
      ).title,
    ).not.toBe('不應保存的名稱');
  });
  it('軟刪草稿在同一SQL單調推進版本，舊retry仍依原權限404', async () => {
    const doc = await newDoc();
    const parent = await retryable(doc);
    await mysql
      .getManager()
      .query(
        "UPDATE esign_documents SET updated_at='2099-01-01 00:00:00.999999' WHERE id=?",
        [doc],
      );
    const before = await version(doc);
    await request(ctx.server)
      .delete(`/api/esign/documents/${doc}`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .expect(204);
    expect((await version(doc)) > before).toBe(true);
    await retry(doc, parent).expect(404);
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
      await manager.delete(User, ids);
    }
    await closeSecurityE2eApp(ctx);
  });
});
