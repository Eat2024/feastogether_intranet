import { randomBytes, randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { AuthService } from '#app/features/auth/services/auth.service';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import { User } from '#app/features/users/entities/user.entity';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { EsignInitiationService } from '#app/features/esign/services/esign-initiation.service';
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

describe('022 背景發起只讀查詢', () => {
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
  function latest(documentId: string, who = cookie) {
    return request(ctx.server)
      .get(`/api/esign/documents/${documentId}/initiation-jobs/latest`)
      .set('Cookie', who);
  }
  function get(documentId: string, jobId: string, who = cookie) {
    return request(ctx.server)
      .get(`/api/esign/documents/${documentId}/initiation-jobs/${jobId}`)
      .set('Cookie', who);
  }
  it('建立人可查 latest；尚無工作回 null，不觸發受理', async () => {
    const documentId = await newDoc();
    const response = await latest(documentId).expect(200);
    expect(apiData<unknown>(response)).toBeNull();
    expect(response.headers['cache-control']).toBe('private, no-store');
  });
  it('latest 以工作順序取最新，重登入可找回 queued 與過去 failed 摘要', async () => {
    const doc = await newDoc();
    const first = await submit(doc, {
      ...body(),
      signers: [{ type: 'employee', employeeNo: 'MISSING022' }],
    });
    await ctx.app.get(EsignInitiationJobService).process(first.id);
    expect(
      apiData<InitiationJobDto>(await latest(doc).expect(200)),
    ).toMatchObject({ jobId: first.publicId, status: 'failed' });
    const second = await submit(doc);
    // 時鐘或舊工作的進度更新不改變「最近受理」的定義。
    await mysql.getManager().update(EsignInitiationJob, first.id, {
      updatedAt: new Date(Date.now() + 86400000),
    });
    const newCookie = await session(users[0].id);
    const current = apiData<InitiationJobDto>(
      await latest(doc, newCookie).expect(200),
    );
    expect(current).toMatchObject({
      jobId: second.publicId,
      status: 'queued',
      attemptCount: 0,
      processedCount: 0,
      totalCount: 1,
    });
    expect(
      apiData<InitiationJobDto>(await get(doc, first.publicId).expect(200))
        .status,
    ).toBe('failed');
  });

  it('job/latest 僅有效建立人可讀，同部門讀者、錯文件或不存在均不洩漏', async () => {
    const doc = await newDoc();
    const job = await submit(doc);
    const empty = await newDoc();
    for (const suffix of ['latest', job.publicId]) {
      await request(ctx.server)
        .get(`/api/esign/documents/${doc}/initiation-jobs/${suffix}`)
        .expect(401);
      await request(ctx.server)
        .get(`/api/esign/documents/${doc}/initiation-jobs/${suffix}`)
        .set('Cookie', otherCookie)
        .expect(404);
      await request(ctx.server)
        .get(`/api/esign/documents/999999999/initiation-jobs/${suffix}`)
        .set('Cookie', cookie)
        .expect(404);
    }
    await get(empty, job.publicId).expect(404);
    await get(doc, '00000000-0000-4000-8000-000000000000').expect(404);
    const readable = apiData<Array<{ id: string }>>(
      await request(ctx.server)
        .get('/api/esign/documents?role=dep')
        .set('Cookie', otherCookie)
        .expect(200),
    );
    expect(readable.some((d) => d.id === doc)).toBe(true);
    await mysql.getManager().update(User, users[0].id, { isActive: false });
    try {
      await expect(
        ctx.app.get(EsignInitiationJobService).latest(Number(doc), users[0].id),
      ).rejects.toMatchObject({ code: 'ESIGN_INITIATION_NOT_FOUND' });
      await expect(
        ctx.app
          .get(EsignInitiationJobService)
          .get(Number(doc), job.publicId, users[0].id),
      ).rejects.toMatchObject({ code: 'ESIGN_INITIATION_NOT_FOUND' });
    } finally {
      await mysql.getManager().update(User, users[0].id, { isActive: true });
    }
  });

  it('重複讀取為輕量只讀摘要，不觸發處理、不回輸入／租約或憑證', async () => {
    const doc = await newDoc();
    const job = await submit(doc);
    const before = await mysql
      .getManager()
      .findOneByOrFail(EsignInitiationJob, { id: job.id });
    const first = apiData<InitiationJobDto>(
      await get(doc, job.publicId).expect(200),
    );
    const keys = [
      'jobId',
      'documentId',
      'status',
      'stage',
      'totalCount',
      'processedCount',
      'attemptCount',
      'acceptedAt',
      'updatedAt',
      'deadlineAt',
      'nextAttemptAt',
      'completedAt',
      'errorCode',
      'retryable',
      'issueCount',
      'detailsExpired',
    ];
    expect(Object.keys(first).sort()).toEqual(keys.sort());
    for (let i = 0; i < 3; i++) {
      const response = await latest(doc).expect(200);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(apiData<InitiationJobDto>(response)).toEqual(first);
    }
    expect(
      await mysql
        .getManager()
        .findOneByOrFail(EsignInitiationJob, { id: job.id }),
    ).toEqual(before);
    // 確認名單變大也不讓讀取路徑載入或回傳完整 JSON。
    const input = {
      ...body(),
      signers: Array.from({ length: 5001 }, (_, i) => ({
        type: 'email' as const,
        name: '合成查詢簽署人'.repeat(8),
        email: `query${i}@example.invalid`,
      })),
    };
    await mysql.getManager().update(EsignInitiationJob, job.id, {
      inputJson: input,
      totalCount: 5001,
    });
    const logger = mysql.getDataSource().logger;
    const trace = jest.spyOn(logger, 'logQuery');
    try {
      const response = await latest(doc).expect(200);
      const large = apiData<InitiationJobDto>(response);
      expect(large.totalCount).toBe(5001);
      expect(JSON.stringify(large).length).toBeLessThan(
        JSON.stringify(first).length + 100,
      );
      const jobReads = trace.mock.calls
        .map(([sql]) => sql)
        .filter((sql) => /FROM `esign_initiation_jobs`/i.test(sql));
      expect(jobReads).toHaveLength(1);
      expect(jobReads[0]).not.toMatch(
        /input_json|issues_json|document_version_json/,
      );
      expect(trace.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(
        /signing_payload_json/,
      );
      expect(
        trace.mock.calls.some(([sql]) =>
          /^\s*(INSERT|UPDATE|DELETE)/i.test(sql),
        ),
      ).toBe(false);
    } finally {
      trace.mockRestore();
    }
  });

  it('查詢時資料庫連線暫時失敗只回錯誤，不把背景工作改成 failed', async () => {
    const doc = await newDoc();
    const job = await submit(doc);
    const unavailable = jest
      .spyOn(mysql.getDataSource().driver, 'obtainMasterConnection')
      .mockRejectedValueOnce(new Error('synthetic database unavailable'));
    try {
      await latest(doc).expect(503);
    } finally {
      unavailable.mockRestore();
    }
    expect(
      apiData<InitiationJobDto>(await latest(doc).expect(200)),
    ).toMatchObject({
      jobId: job.publicId,
      status: 'queued',
      attemptCount: 0,
      errorCode: null,
    });
  });

  it('worker 處理前列表仍 draft，成功後才 active，列表不新增工作摘要欄位', async () => {
    const doc = await newDoc();
    const job = await submit(doc);
    async function item() {
      const items = apiData<Array<Record<string, unknown>>>(
        await request(ctx.server)
          .get('/api/esign/documents?role=created')
          .set('Cookie', cookie)
          .expect(200),
      );
      const row = items.find((d) => d.id === doc);
      expect(row).toBeDefined();
      expect(row).not.toHaveProperty('initiationSummary');
      return row;
    }
    expect(await item()).toMatchObject({ status: 'draft' });
    const core = ctx.app.get(EsignInitiationService);
    const execute = core.initiateInTransaction.bind(
      core,
    ) as typeof core.initiateInTransaction;
    const held = jest
      .spyOn(core, 'initiateInTransaction')
      .mockImplementationOnce(async (...args) => {
        expect(
          apiData<InitiationJobDto>(await latest(doc).expect(200)),
        ).toMatchObject({
          status: 'processing',
          stage: 'committing',
          processedCount: 1,
          attemptCount: 1,
        });
        expect(await item()).toMatchObject({ status: 'draft' });
        return execute(...args);
      });
    try {
      await ctx.app.get(EsignInitiationJobService).process(job.id);
    } finally {
      held.mockRestore();
    }
    expect(
      apiData<InitiationJobDto>(await latest(doc).expect(200)),
    ).toMatchObject({
      status: 'succeeded',
      stage: 'completed',
      processedCount: 1,
    });
    expect(await item()).toMatchObject({ status: 'active' });
    const conflict = await request(ctx.server)
      .patch(`/api/esign/documents/${doc}/draft-settings`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({ watermark: false })
      .expect(409);
    expect(apiError(conflict).code).not.toBe('ESIGN_INITIATION_IN_PROGRESS');
  });

  it('成功後的合法重播不重新讀取正式簽署大型快照', async () => {
    const doc = await newDoc();
    const input = body();
    const key = randomUUID();
    const job = await submit(doc, input, key);
    await ctx.app.get(EsignInitiationJobService).process(job.id);
    const trace = jest.spyOn(mysql.getDataSource().logger, 'logQuery');
    try {
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
      });
      expect(trace.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(
        /signing_payload_json|input_json|issues_json|document_version_json/,
      );
    } finally {
      trace.mockRestore();
    }
  });

  it('22 份大型工作輸入在 256KiB sort buffer 下列表成功，SQL 數不隨文件增加', async () => {
    const runner = mysql.getDataSource().createQueryRunner();
    await runner.connect();
    try {
      await runner.query('SET SESSION sort_buffer_size=262144');
      const query = runner.query.bind(runner) as typeof runner.query;
      const trace = jest
        .spyOn(runner, 'query')
        .mockImplementation(
          (sql: string, params?: unknown[], structured?: boolean) =>
            query(
              sql.replace(
                /FROM `esign_documents` `([^`]+)`/g,
                '$& USE INDEX (`idx_esign_documents_deleted_at`)',
              ),
              params,
              structured,
            ),
        );
      async function read() {
        const manager = jest
          .spyOn(mysql, 'getManager')
          .mockReturnValue(runner.manager);
        trace.mockClear();
        try {
          const rows = apiData<Array<Record<string, unknown>>>(
            await request(ctx.server)
              .get('/api/esign/documents?role=dep')
              .set('Cookie', cookie)
              .expect(200),
          );
          const selects = trace.mock.calls
            .map(([sql]) => sql)
            .filter((sql) => /^SELECT/i.test(sql));
          expect(
            selects.some((sql) =>
              /esign_initiation_jobs|input_json|issues_json|document_version_json/.test(
                sql,
              ),
            ),
          ).toBe(false);
          expect(rows.every((row) => !('initiationSummary' in row))).toBe(true);
          return { rows, queries: selects.length };
        } finally {
          manager.mockRestore();
        }
      }
      try {
        const baseline = await read();
        const input: InitiateDocumentDto = {
          ...body(),
          signers: Array.from({ length: 5001 }, (_, i) => ({
            type: 'email',
            name: '合成大型名單'.repeat(10),
            email: `large${i}@example.invalid`,
          })),
        };
        expect(Buffer.byteLength(JSON.stringify(input))).toBeGreaterThan(
          262144,
        );
        for (let i = 0; i < 22; i++) {
          const job = await submit(await newDoc());
          await mysql.getManager().update(EsignInitiationJob, job.id, {
            inputJson: input,
            totalCount: 5001,
          });
        }
        const after = await read();
        expect(after.rows).toHaveLength(baseline.rows.length + 22);
        expect(after.queries).toBe(baseline.queries);
      } finally {
        trace.mockRestore();
      }
    } finally {
      await runner.release();
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
        for (const table of [
          'esign_initiation_jobs',
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
