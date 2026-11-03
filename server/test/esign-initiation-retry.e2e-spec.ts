import { DataSource } from 'typeorm';
import { randomBytes, randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { AuthService } from '#app/features/auth/services/auth.service';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
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

describe('022 失敗恢復與人工重試', () => {
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
    return `${AUTH_COOKIE_NAME}=${(await ctx.app.get(AuthService).issueSession(userId)).token}`;
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
  it('建立人重登入後還原確認輸入，其他人不可讀', async () => {
    const doc = await newDoc();
    const input: InitiateDocumentDto = {
      ...body(),
      signers: [
        { type: 'employee', employeeNo: 'MISSING022' },
        { type: 'email', name: '合成外部人', email: 'restore@example.com' },
      ],
    };
    const job = await submit(doc, input);
    const url = `/api/esign/documents/${doc}/initiation-jobs/${job.publicId}/input`;
    const response = await request(ctx.server)
      .get(url)
      .set('Cookie', await session(users[0].id))
      .expect(200);
    expect(apiData(response)).toEqual(input);
    expect(response.headers['cache-control']).toBe('private, no-store');
    await request(ctx.server).get(url).set('Cookie', otherCookie).expect(404);
    await request(ctx.server).get(url).expect(401);
  });

  it('查核失敗保留每個問題位置並分頁；外部項目不洩漏信箱', async () => {
    const doc = await newDoc();
    const input: InitiateDocumentDto = {
      ...body(),
      signers: [
        { type: 'email', name: '合成外部人', email: 'synthetic@example.com' },
        ...Array.from({ length: 502 }, (_, i) => ({
          type: 'employee' as const,
          employeeNo: `MISSING${i}`,
        })),
      ],
    };
    const job = await submit(doc, input);
    const url = `/api/esign/documents/${doc}/initiation-jobs/${job.publicId}/issues`;
    expect(
      apiError(
        await request(ctx.server).get(url).set('Cookie', cookie).expect(409),
      ).code,
    ).toBe('ESIGN_INITIATION_ISSUES_NOT_READY');
    await ctx.app.get(EsignInitiationJobService).process(job.id);
    const page = apiData<{
      total: number;
      items: unknown[];
      nextOffset: number;
    }>(await request(ctx.server).get(url).set('Cookie', cookie).expect(200));
    expect(page.total).toBe(502);
    expect(page.items).toHaveLength(100);
    expect(page.nextOffset).toBe(100);
    expect(page.items[0]).toEqual({
      inputIndex: 1,
      employeeNo: 'MISSING0',
      code: 'EMPLOYEE_UNAVAILABLE',
      message: '員工資料尚未同步或帳號不可使用，請確認後重新提交。',
    });
    const last = apiData<{ items: unknown[]; nextOffset: null }>(
      await request(ctx.server)
        .get(url + '?offset=500&limit=2')
        .set('Cookie', cookie)
        .expect(200),
    );
    expect(last.items).toHaveLength(2);
    expect(last.nextOffset).toBeNull();
    expect(JSON.stringify(page)).not.toContain('synthetic@example.com');
    for (const query of ['offset=-1', 'offset=1.5', 'limit=0', 'limit=101'])
      await request(ctx.server)
        .get(url + '?' + query)
        .set('Cookie', cookie)
        .expect(400);
    await request(ctx.server).get(url).set('Cookie', otherCookie).expect(404);
    expect(
      apiData<InitiationJobDto>(await get(doc, job.publicId).expect(200))
        .issueCount,
    ).toBe(502);
    await mysql
      .getManager()
      .update(EsignInitiationJob, job.id, {
        inputJson: null,
        issuesJson: null,
        documentVersionJson: null,
        inputPurgedAt: new Date(),
      });
    await request(ctx.server).get(url).set('Cookie', cookie).expect(410);
    await request(ctx.server)
      .get(url.replace('/issues', '/input'))
      .set('Cookie', cookie)
      .expect(410);
  });

  async function retryable(doc: string, input = body()) {
    const job = await submit(doc, input);
    // 已驗證的 worker 終態作為人工重試起點；不依賴真實上游故障。
    await mysql
      .getManager()
      .update(EsignInitiationJob, job.id, {
        status: 'failed',
        stage: 'failed',
        completedAt: new Date(),
        errorCode: 'ESIGN_INITIATION_TRANSIENT_FAILURE',
        retryable: true,
        attemptCount: 3,
      });
    return job;
  }
  function retry(
    doc: string,
    jobId: string,
    key = randomUUID(),
    who = cookie,
    payload: unknown = {},
  ) {
    return request(ctx.server)
      .post(`/api/esign/documents/${doc}/initiation-jobs/${jobId}/retries`)
      .set('Cookie', who)
      .set('Origin', origin)
      .set('Idempotency-Key', key)
      .send(payload);
  }
  it('人工重試建立新工作；回應遺失重送、child 成功與 parent 清理後皆重播原 child', async () => {
    const doc = await newDoc();
    const parent = await retryable(doc);
    const key = randomUUID();
    const accepted = apiData<InitiationJobDto>(
      await retry(doc, parent.publicId, key).expect(202),
    );
    const child = await mysql
      .getManager()
      .findOneByOrFail(EsignInitiationJob, { publicId: accepted.jobId });
    ownedJobs.add(child.id);
    expect(child.id).not.toBe(parent.id);
    expect(String(child.parentJobId)).toBe(String(parent.id));
    expect(child.requestHash).not.toBe(parent.requestHash);
    expect(
      apiData<InitiationJobDto>(
        await retry(doc, parent.publicId, key).expect(200),
      ),
    ).toMatchObject({ jobId: child.publicId, reused: true, status: 'queued' });
    const busy = apiError(
      await request(ctx.server)
        .patch(`/api/esign/documents/${doc}`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .field('title', '不應修改')
        .expect(409),
    );
    expect(busy).toMatchObject({
      code: 'ESIGN_INITIATION_IN_PROGRESS',
      message:
        '文件正在背景發起中（worker 執行中），暫時無法修改文件或簽署人，請稍後再試。',
    });
    await ctx.app.get(EsignInitiationJobService).process(child.id);
    expect(
      apiData<InitiationJobDto>(
        await retry(doc, parent.publicId, key).expect(200),
      ),
    ).toMatchObject({ jobId: child.publicId, status: 'succeeded' });
    await mysql
      .getManager()
      .update(EsignInitiationJob, parent.id, {
        inputJson: null,
        issuesJson: null,
        documentVersionJson: null,
        inputPurgedAt: new Date(),
      });
    expect(
      apiData<InitiationJobDto>(
        await retry(doc, parent.publicId, key).expect(200),
      ).jobId,
    ).toBe(child.publicId);
    await retry(doc, parent.publicId, key, otherCookie).expect(404);
  });

  it('新 key 驗最新 failed、可重試、版本、期限及明細；修改內容另發起', async () => {
    const doc = await newDoc();
    const parent = await retryable(doc);
    const url = `/api/esign/documents/${doc}/initiation-jobs/${parent.publicId}/retries`;
    await request(ctx.server)
      .post(url)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({})
      .expect(400);
    await retry(doc, parent.publicId, 'bad-key').expect(400);
    await retry(doc, parent.publicId, randomUUID(), cookie, {
      signers: body().signers,
    }).expect(400);
    await retry(doc, parent.publicId, randomUUID(), cookie, []).expect(400);
    await request(ctx.server)
      .post(url)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(401);
    await request(ctx.server)
      .post(url)
      .set('Cookie', cookie)
      .set('Origin', 'https://untrusted.example')
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(403);
    await retry(doc, parent.publicId, parent.requestKey).expect(409);
    await retry(doc, randomUUID()).expect(404);
    await retry(await newDoc(), parent.publicId).expect(404);
    await mysql
      .getManager()
      .update(EsignInitiationJob, parent.id, { retryable: false });
    expect(apiError(await retry(doc, parent.publicId).expect(409)).code).toBe(
      'ESIGN_INITIATION_RETRY_NOT_ALLOWED',
    );
    await mysql
      .getManager()
      .update(EsignInitiationJob, parent.id, { retryable: true });
    await request(ctx.server)
      .patch(`/api/esign/documents/${doc}`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .field('title', '修正後文件')
      .expect(200);
    expect(apiError(await retry(doc, parent.publicId).expect(409)).code).toBe(
      'ESIGN_INITIATION_DOCUMENT_CHANGED',
    );
    const replacement = await submit(doc, { ...body(), watermark: false });
    expect(replacement.parentJobId).toBeNull();
    await mysql
      .getManager()
      .update(EsignInitiationJob, replacement.id, {
        status: 'failed',
        stage: 'failed',
        completedAt: new Date(),
        errorCode: 'ESIGN_INITIATION_INTERNAL_ERROR',
      });
    expect(apiError(await retry(doc, parent.publicId).expect(409)).code).toBe(
      'ESIGN_INITIATION_RETRY_NOT_ALLOWED',
    );
    const expiredDoc = await newDoc();
    const expired = await retryable(expiredDoc);
    await mysql
      .getManager()
      .update(EsignInitiationJob, expired.id, {
        inputJson: {
          ...body(),
          signEndAt: new Date(Date.now() - 1000).toISOString(),
        },
      });
    expect(
      apiError(await retry(expiredDoc, expired.publicId).expect(409)).code,
    ).toBe('ESIGN_INITIATION_DEADLINE_PASSED');
    await mysql
      .getManager()
      .update(EsignInitiationJob, expired.id, {
        inputJson: null,
        documentVersionJson: null,
        inputPurgedAt: new Date(),
      });
    expect(
      apiError(await retry(expiredDoc, expired.publicId).expect(410)).code,
    ).toBe('ESIGN_INITIATION_INPUT_EXPIRED');
  });
  it('同 key 並行重送只受理一個 child；另一 parent/key 不得混淆', async () => {
    const doc = await newDoc();
    const parent = await retryable(doc);
    const key = randomUUID();
    const responses = await Promise.all([
      retry(doc, parent.publicId, key),
      retry(doc, parent.publicId, key),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 202]);
    const first = apiData<InitiationJobDto>(responses[0]);
    expect(apiData<InitiationJobDto>(responses[1]).jobId).toBe(first.jobId);
    const child = await mysql
      .getManager()
      .findOneByOrFail(EsignInitiationJob, { publicId: first.jobId });
    ownedJobs.add(child.id);
    expect(
      apiError(await retry(doc, child.publicId, key).expect(409)).code,
    ).toBe('ESIGN_INITIATION_REQUEST_CONFLICT');
    expect(apiError(await retry(doc, parent.publicId).expect(409)).code).toBe(
      'ESIGN_INITIATION_IN_PROGRESS',
    );
    await mysql.getManager().update(User, users[0].id, { isActive: false });
    try {
      await expect(
        ctx.app
          .get(EsignInitiationJobService)
          .retry(Number(doc), parent.publicId, users[0].id, key, {}),
      ).rejects.toMatchObject({ code: 'ESIGN_INITIATION_NOT_FOUND' });
    } finally {
      await mysql.getManager().update(User, users[0].id, { isActive: true });
    }
  });
  it('外部姓名查核失敗只回原輸入索引，不回姓名或信箱', async () => {
    const doc = await newDoc();
    const job = await submit(doc, {
      ...body(),
      signers: [
        { type: 'email', name: '   ', email: 'private-synthetic@example.com' },
      ],
    });
    await ctx.app.get(EsignInitiationJobService).process(job.id);
    const page = apiData<{ items: unknown[] }>(
      await request(ctx.server)
        .get(
          `/api/esign/documents/${doc}/initiation-jobs/${job.publicId}/issues`,
        )
        .set('Cookie', cookie)
        .expect(200),
    );
    expect(page.items).toEqual([
      {
        inputIndex: 0,
        code: 'INPUT_INVALID',
        message: '發起設定不合法，請確認名單、欄位與文件。',
      },
    ]);
  });

  it('預查後員工失效，正式鎖內查核仍記錄原始名單位置', async () => {
    const doc = await newDoc();
    const job = await submit(doc, {
      ...body(),
      signers: [{ type: 'user', userId: String(users[1].id) }],
    });
    // 外部異動者獨立連線，保留 app pool2 給 worker 與 HTTP 觀察。
    const blocker = await new DataSource(
      mysql.getDataSource().options,
    ).initialize();
    const runner = blocker.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let processing: Promise<void> | undefined;
    try {
      await runner.query('SELECT id FROM users WHERE id=? FOR UPDATE', [
        users[1].id,
      ]);
      processing = ctx.app.get(EsignInitiationJobService).process(job.id);
      const until = Date.now() + 5000;
      while (Date.now() < until) {
        const summary = apiData<InitiationJobDto>(
          await get(doc, job.publicId).expect(200),
        );
        if (summary.stage === 'committing') break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(
        apiData<InitiationJobDto>(await get(doc, job.publicId).expect(200))
          .stage,
      ).toBe('committing');
      await runner.query('UPDATE users SET is_active=0 WHERE id=?', [
        users[1].id,
      ]);
      await runner.commitTransaction();
      await processing;
      const page = apiData<{ items: unknown[] }>(
        await request(ctx.server)
          .get(
            `/api/esign/documents/${doc}/initiation-jobs/${job.publicId}/issues`,
          )
          .set('Cookie', cookie)
          .expect(200),
      );
      expect(page.items).toEqual([
        {
          inputIndex: 0,
          employeeNo: users[1].empid,
          code: 'EMPLOYEE_UNAVAILABLE',
          message: '員工資料尚未同步或帳號不可使用，請確認後重新提交。',
        },
      ]);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await blocker.destroy();
      await processing;
      await mysql.getManager().update(User, users[1].id, { isActive: true });
    }
  });

  it('重試等待文件鎖後以最新版本拒絕，不沿用受理時舊快照', async () => {
    const doc = await newDoc();
    const parent = await retryable(doc);
    // 外部異動者獨立連線，保留 app pool2 給 worker 與 HTTP 觀察。
    const blocker = await new DataSource(
      mysql.getDataSource().options,
    ).initialize();
    const runner = blocker.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let pending: Promise<request.Response> | undefined;
    try {
      await runner.query(
        'SELECT id FROM esign_documents WHERE id=? FOR UPDATE',
        [doc],
      );
      pending = retry(doc, parent.publicId).then((response) => response);
      await runner.query(
        'UPDATE esign_documents SET title=?,updated_at=UTC_TIMESTAMP(6) WHERE id=?',
        ['合成並行修正', doc],
      );
      await runner.commitTransaction();
      const response = await pending;
      expect(response.status).toBe(409);
      expect(apiError(response).code).toBe('ESIGN_INITIATION_DOCUMENT_CHANGED');
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await blocker.destroy();
      await pending;
    }
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
        for (const table of [
          'esign_audit_events',
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
