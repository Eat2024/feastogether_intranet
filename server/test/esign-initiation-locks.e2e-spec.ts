import { createConnection } from 'mysql2/promise';
import { writeFile } from 'node:fs/promises';
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

describe('022 員工共享鎖與跨文件受理', () => {
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
  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }
  it.each(['initial', 'retry'] as const)(
    '同建立人兩份文件同時%s不因缺列gap死鎖回503',
    async (operation) => {
      const first = await newDoc();
      const second = await newDoc();
      const parents: EsignInitiationJob[] = [];
      if (operation === 'retry') {
        for (const doc of [first, second]) {
          const parent = await submit(doc);
          await mysql.getManager().update(EsignInitiationJob, parent.id, {
            status: 'failed',
            stage: 'failed',
            completedAt: new Date(),
            errorCode: 'ESIGN_INITIATION_TRANSIENT_FAILURE',
            retryable: true,
          });
          parents.push(parent);
        }
      }
      const db = mysql.getDataSource();
      type Isolation = { sessionIsolation: string; globalIsolation: string };
      const isolationSql =
        'SELECT @@SESSION.transaction_isolation AS sessionIsolation, @@GLOBAL.transaction_isolation AS globalIsolation';
      const before = await mysql.query<Isolation[]>(isolationSql);
      const afterCommits: Isolation[][] = [];
      const isolationStatements: string[] = [];
      const createRunner = db.createQueryRunner.bind(
        db,
      ) as typeof db.createQueryRunner;
      const ready = deferred();
      let inserts = 0;
      const databaseErrors: string[] = [];
      const runners: Array<ReturnType<typeof createRunner>> = [];
      const barrier = jest
        .spyOn(db, 'createQueryRunner')
        .mockImplementation((...args) => {
          const runner = createRunner(...args);
          runners.push(runner);
          const query = runner.query.bind(runner) as typeof runner.query;
          jest
            .spyOn(runner, 'query')
            .mockImplementation(async (...queryArgs) => {
              if (queryArgs[0].startsWith('SET TRANSACTION ISOLATION LEVEL'))
                isolationStatements.push(queryArgs[0]);
              if (
                queryArgs[0].startsWith('INSERT INTO `esign_initiation_jobs`')
              ) {
                inserts++;
                if (inserts === 2) ready.resolve();
                await ready.promise;
              }
              try {
                const result: unknown = await query(...queryArgs);
                if (queryArgs[0] === 'COMMIT')
                  afterCommits.push(await query<Isolation[]>(isolationSql));
                return result;
              } catch (error: unknown) {
                if (error && typeof error === 'object' && 'code' in error)
                  databaseErrors.push(String(error.code));
                throw error;
              }
            });
          return runner;
        });
      try {
        const responses = await Promise.all(
          [first, second].map((doc, index) =>
            request(ctx.server)
              .post(
                operation === 'initial'
                  ? `/api/esign/documents/${doc}/initiations`
                  : `/api/esign/documents/${doc}/initiation-jobs/${parents[index].publicId}/retries`,
              )
              .set('Cookie', cookie)
              .set('Origin', origin)
              .set('Idempotency-Key', randomUUID())
              .send(operation === 'initial' ? body() : {}),
          ),
        );
        // 即使紅燈也記錄成功建立的工作，供本測試清理 queue。
        for (const doc of [first, second]) {
          const rows = await mysql
            .getManager()
            .findBy(EsignInitiationJob, { documentId: Number(doc) });
          rows.forEach((row) => ownedJobs.add(row.id));
        }
        await writeFile(
          '/tmp/022-accept-gap-evidence.json',
          JSON.stringify({
            statuses: responses.map((r) => r.status),
            databaseErrors,
          }),
        );
        expect(responses.map((r) => r.status)).toEqual([202, 202]);
        expect(isolationStatements).toEqual(
          Array(2).fill('SET TRANSACTION ISOLATION LEVEL READ COMMITTED'),
        );
        expect(afterCommits).toHaveLength(2);
        afterCommits.forEach((settings) => expect(settings).toEqual(before));
        await mysql.transaction(async (manager) => {
          expect(await manager.query<Isolation[]>(isolationSql)).toEqual(
            before,
          );
        });
        expect(isolationStatements).toHaveLength(2);
      } finally {
        ready.resolve();
        barrier.mockRestore();
        runners.forEach((runner) => jest.spyOn(runner, 'query').mockRestore());
      }
    },
  );

  it('受理預檢後才出現active工作，鎖內409仍回public existingJobId', async () => {
    const doc = await newDoc();
    const db = mysql.getDataSource();
    const createRunner = db.createQueryRunner.bind(
      db,
    ) as typeof db.createQueryRunner;
    const entered = deferred();
    const release = deferred();
    let held = false;
    const jobReads: string[] = [];
    const querySpies: jest.SpyInstance[] = [];
    const barrier = jest
      .spyOn(db, 'createQueryRunner')
      .mockImplementation((...args) => {
        const runner = createRunner(...args);
        const query = runner.query.bind(runner) as typeof runner.query;
        querySpies.push(
          jest
            .spyOn(runner, 'query')
            .mockImplementation(async (...queryArgs) => {
              if (
                queryArgs[0].startsWith('SELECT') &&
                queryArgs[0].includes('FROM `esign_initiation_jobs`')
              )
                jobReads.push(queryArgs[0]);
              if (
                !held &&
                queryArgs[0].includes('FROM `esign_documents`') &&
                queryArgs[0].endsWith('FOR UPDATE')
              ) {
                held = true;
                entered.resolve();
                await release.promise;
              }
              return query(...queryArgs) as Promise<unknown>;
            }),
        );
        return runner;
      });
    const attempt = request(ctx.server)
      .post(`/api/esign/documents/${doc}/initiations`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send(body())
      .then((response) => response);
    try {
      await entered.promise;
      const accepted = await submit(doc);
      release.resolve();
      const response = await attempt;
      expect(response.status).toBe(409);
      expect(apiError(response).code).toBe('ESIGN_INITIATION_IN_PROGRESS');
      expect(apiError(response).details).toEqual({
        existingJobId: accepted.publicId,
      });
      expect(jobReads.length).toBeGreaterThan(0);
      expect(jobReads.join('\n')).not.toMatch(
        /input_json|document_version_json|issues_json/,
      );
    } finally {
      release.resolve();
      await attempt;
      querySpies.forEach((spy) => spy.mockRestore());
      barrier.mockRestore();
    }
  });

  it('正式worker持users/document/job鎖5秒時，同建立人另一份文件仍在3秒內受理', async () => {
    const doc = await newDoc();
    const second = await newDoc();
    const initialKey = randomUUID();
    const initialInput = {
      ...body(),
      signers: [{ type: 'user' as const, userId: String(users[1].id) }],
    };
    const job = await submit(doc, initialInput, initialKey);
    const storage = ctx.app.get<PrivateFileStorage>(PRIVATE_FILE_STORAGE);
    const original: PrivateFileStorage['openReadStream'] =
      storage.openReadStream.bind(
        storage,
      ) as PrivateFileStorage['openReadStream'];
    const entered = deferred();
    let heldMs = 0;
    const gate = jest
      .spyOn(storage, 'openReadStream')
      .mockImplementationOnce(async (...args) => {
        const start = performance.now();
        entered.resolve();
        await new Promise((resolve) => setTimeout(resolve, 5000));
        heldMs = performance.now() - start;
        return original(...args);
      });
    const processing = ctx.app.get(EsignInitiationJobService).process(job.id);
    let acceptedMs = 0;
    try {
      await entered.promise;
      const sameStarted = performance.now();
      const mutation = request(ctx.server)
        .put(`/api/esign/documents/${doc}/fields`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send({ fields: body().fields })
        .then((response) => ({
          response,
          elapsedMs: performance.now() - sameStarted,
        }));
      const start = performance.now();
      const accepted = await submit(second);
      acceptedMs = performance.now() - start;
      for (const key of [undefined, randomUUID()]) {
        const attempt = request(ctx.server)
          .post(`/api/esign/documents/${doc}/initiations`)
          .set('Cookie', cookie)
          .set('Origin', origin)
          .send(body());
        if (key) attempt.set('Idempotency-Key', key);
        const response = await attempt.timeout({
          response: 1500,
          deadline: 2000,
        });
        expect(response.status).toBe(409);
        expect(apiError(response).code).toBe('ESIGN_INITIATION_IN_PROGRESS');
        expect(apiError(response).details).toEqual({
          existingJobId: job.publicId,
        });
      }
      const retry = await request(ctx.server)
        .post(
          `/api/esign/documents/${doc}/initiation-jobs/${job.publicId}/retries`,
        )
        .set('Cookie', cookie)
        .set('Origin', origin)
        .set('Idempotency-Key', randomUUID())
        .send({})
        .timeout({ response: 1500, deadline: 2000 });
      expect(retry.status).toBe(409);
      expect(apiError(retry).code).toBe('ESIGN_INITIATION_IN_PROGRESS');
      expect(apiError(retry).details).toEqual({ existingJobId: job.publicId });
      const edits = [
        () =>
          request(ctx.server)
            .patch(`/api/esign/documents/${doc}/draft-settings`)
            .send({ watermark: false }),
        () =>
          request(ctx.server)
            .put(`/api/esign/documents/${doc}/draftSave`)
            .send({ signers: [{ type: 'user', userId: String(users[1].id) }] }),
        () =>
          request(ctx.server)
            .patch(`/api/esign/documents/${doc}`)
            .field('title', '修改標題'),
        () =>
          request(ctx.server)
            .patch(`/api/esign/documents/${doc}`)
            .attach('file', pdf, {
              filename: 'new.pdf',
              contentType: 'application/pdf',
            }),
        () => request(ctx.server).delete(`/api/esign/documents/${doc}`),
        () =>
          request(ctx.server)
            .patch(`/api/esign/documents/${doc}/signers/${randomUUID()}/note`)
            .send({ note: '註記' }),
        () =>
          request(ctx.server)
            .post(`/api/esign/documents/${doc}/stoppages`)
            .send({ reason: '停止' }),
        () =>
          request(ctx.server)
            .post(`/api/esign/documents/${doc}/reopenings`)
            .send({
              reason: '補簽',
              expectedSignEndAt: body().signEndAt,
              signEndAt: body().signEndAt,
            }),
        () =>
          request(ctx.server)
            .post(`/api/esign/documents/${doc}/notification-batches`)
            .send({ requestId: randomUUID(), selection: 'all_pending' }),
      ];
      for (const edit of edits) {
        const response = await edit()
          .set('Cookie', cookie)
          .set('Origin', origin)
          .timeout({ response: 1500, deadline: 2000 });
        expect(response.status).toBe(409);
        expect(apiError(response).code).toBe('ESIGN_INITIATION_IN_PROGRESS');
        expect(apiError(response).details).toEqual({
          existingJobId: job.publicId,
        });
        expect(apiError(response).message).toBe(
          '文件正在背景發起中（worker 執行中），暫時無法修改文件或簽署人，請稍後再試。',
        );
        const forbidden = await edit()
          .set('Cookie', otherCookie)
          .set('Origin', origin)
          .timeout({ response: 1500, deadline: 2000 });
        expect(forbidden.status).toBe(404);
        expect(apiError(forbidden).code).toBe('ESIGN_RESOURCE_NOT_FOUND');
        expect(apiError(forbidden).details).toBeUndefined();
      }
      const denied = await request(ctx.server)
        .put(`/api/esign/documents/${doc}/fields`)
        .set('Cookie', otherCookie)
        .set('Origin', origin)
        .send({ fields: body().fields })
        .timeout({ response: 1500, deadline: 2000 });
      expect(denied.status).toBe(404);
      expect(apiError(denied).code).toBe('ESIGN_RESOURCE_NOT_FOUND');
      const replayPromise = request(ctx.server)
        .post(`/api/esign/documents/${doc}/initiations`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .set('Idempotency-Key', initialKey)
        .send(initialInput)
        .expect(200)
        .then((response) => apiData<InitiationJobDto>(response));
      await processing;
      expect(await replayPromise).toMatchObject({
        jobId: job.publicId,
        status: 'succeeded',
        reused: true,
      });
      const same = await mutation;
      await writeFile(
        '/tmp/022-worker-shared-lock-benchmark.json',
        JSON.stringify(
          {
            heldMs,
            acceptedMs,
            secondStatus: accepted.status,
            sameDocumentEdit: {
              status: same.response.status,
              elapsedMs: same.elapsedMs,
              ...apiError(same.response),
            },
          },
          null,
          2,
        ),
      );
      expect(
        apiData<InitiationJobDto>(await get(doc, job.publicId).expect(200))
          .status,
      ).toBe('succeeded');
      expect(heldMs).toBeGreaterThanOrEqual(4900);
      expect(acceptedMs).toBeLessThan(3000);
      expect(same.elapsedMs).toBeLessThan(3000);
      expect(apiError(same.response).code).toBe('ESIGN_INITIATION_IN_PROGRESS');
    } finally {
      gate.mockRestore();
      await processing;
    }
  });

  async function externalConnection() {
    return createConnection({
      host: process.env.DB_MYSQL_HOST,
      port: Number(process.env.DB_MYSQL_PORT),
      user: process.env.DB_MYSQL_USER,
      password: process.env.DB_MYSQL_PASS,
      database: process.env.DB_MYSQL_DB,
    });
  }
  async function waitForUserLock(userId: number) {
    const until = Date.now() + 3000;
    while (Date.now() < until) {
      const waits = await mysql
        .getManager()
        .query<
          Array<{ requested: string; held: string }>
        >(`SELECT r.LOCK_MODE AS requested,b.LOCK_MODE AS held FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks r ON r.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID JOIN performance_schema.data_locks b ON b.ENGINE_LOCK_ID=w.BLOCKING_ENGINE_LOCK_ID WHERE r.OBJECT_SCHEMA=DATABASE() AND r.OBJECT_NAME='users' AND r.INDEX_NAME='PRIMARY' AND r.LOCK_DATA=?`, [String(userId)]);
      if (waits.length) return waits[0];
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('沒有觀察到預期的員工列鎖等待');
  }
  it('已有新active工作時，歷史initial與retry key仍重播原摘要且驗證hash/parent', async () => {
    const doc = await newDoc();
    const initialKey = randomUUID();
    const input = {
      ...body(),
      signers: [{ type: 'employee' as const, employeeNo: 'MISSINGLOCK22' }],
    };
    const parent = await submit(doc, input, initialKey);
    await ctx.app.get(EsignInitiationJobService).process(parent.id);
    // 模擬可人工重試的暫時失敗，聚焦歷史 key 的重播順序。
    await mysql.getManager().update(EsignInitiationJob, parent.id, {
      retryable: true,
      errorCode: 'ESIGN_INITIATION_TRANSIENT_FAILURE',
    });
    const retryKey = randomUUID();
    const retryRequest = (parentId = parent.publicId) =>
      request(ctx.server)
        .post(`/api/esign/documents/${doc}/initiation-jobs/${parentId}/retries`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .set('Idempotency-Key', retryKey)
        .send({});
    const child = apiData<InitiationJobDto>(await retryRequest().expect(202));
    const childEntity = await mysql
      .getManager()
      .findOneByOrFail(EsignInitiationJob, { publicId: child.jobId });
    ownedJobs.add(childEntity.id);
    await ctx.app.get(EsignInitiationJobService).process(childEntity.id);
    await submit(doc);
    const original = apiData<InitiationJobDto>(
      await request(ctx.server)
        .post(`/api/esign/documents/${doc}/initiations`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .set('Idempotency-Key', initialKey)
        .send(input)
        .expect(200),
    );
    expect(original).toMatchObject({
      jobId: parent.publicId,
      status: 'failed',
      reused: true,
    });
    const replay = apiData<InitiationJobDto>(await retryRequest().expect(200));
    expect(replay).toMatchObject({
      jobId: child.jobId,
      status: 'failed',
      reused: true,
    });
    const conflict = await request(ctx.server)
      .post(`/api/esign/documents/${doc}/initiations`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', initialKey)
      .send(body())
      .expect(409);
    expect(apiError(conflict).code).toBe('ESIGN_INITIATION_REQUEST_CONFLICT');
    const wrongParent = await retryRequest(child.jobId).expect(409);
    expect(apiError(wrongParent).code).toBe(
      'ESIGN_INITIATION_REQUEST_CONFLICT',
    );
    await retryRequest(randomUUID()).expect(404);
  });

  it.each([
    ['停用', 'UPDATE users SET is_active=0 WHERE id=?'],
    ['信箱', "UPDATE users SET email='after@example.test' WHERE id=?"],
    [
      '同步',
      "UPDATE users SET name='同步後合成姓名',empid='LOCKUPDATED' WHERE id=?",
    ],
  ])(
    '正式共享鎖阻擋%s異動至commit，快照沿用鎖內原資料',
    async (_label, sql) => {
      await mysql
        .getManager()
        .update(User, users[1].id, { email: 'before@example.test' });
      const doc = await newDoc();
      const job = await submit(doc, {
        ...body(),
        signers: [{ type: 'user', userId: String(users[1].id) }],
      });
      const storage = ctx.app.get<PrivateFileStorage>(PRIVATE_FILE_STORAGE);
      const original: PrivateFileStorage['openReadStream'] =
        storage.openReadStream.bind(
          storage,
        ) as PrivateFileStorage['openReadStream'];
      const entered = deferred();
      const release = deferred();
      const gate = jest
        .spyOn(storage, 'openReadStream')
        .mockImplementationOnce(async (...args) => {
          entered.resolve();
          await release.promise;
          return original(...args);
        });
      const writer = await externalConnection();
      const processing = ctx.app.get(EsignInitiationJobService).process(job.id);
      let mutation: Promise<unknown> | undefined;
      try {
        await entered.promise;
        mutation = writer.query(sql, [users[1].id]);
        const lock = await waitForUserLock(users[1].id);
        expect(lock.requested.startsWith('X')).toBe(true);
        expect(lock.held.startsWith('S')).toBe(true);
        release.resolve();
        await processing;
        await mutation;
        expect(
          apiData<InitiationJobDto>(await get(doc, job.publicId).expect(200))
            .status,
        ).toBe('succeeded');
        expect(
          await mysql
            .getManager()
            .query<
              Array<{ email: string; empid_snapshot: string }>
            >('SELECT email,empid_snapshot FROM esign_signers WHERE document_id=?', [doc]),
        ).toEqual([
          { email: 'before@example.test', empid_snapshot: users[1].empid },
        ]);
      } finally {
        release.resolve();
        await processing;
        await mutation;
        gate.mockRestore();
        await writer.end();
        await mysql.getManager().update(User, users[1].id, {
          isActive: true,
          email: null,
          empid: users[1].empid,
          name: users[1].name,
        });
      }
    },
  );
  it.each([0, 1])(
    '帳號%s停用交易先取得X鎖時，worker共享current read等待並拒絕正式發起',
    async (target) => {
      const doc = await newDoc();
      const job = await submit(doc, {
        ...body(),
        signers: [{ type: 'user', userId: String(users[1].id) }],
      });
      const writer = await externalConnection();
      await writer.beginTransaction();
      let processing: Promise<void> | undefined;
      try {
        await writer.query('UPDATE users SET is_active=0 WHERE id=?', [
          users[target].id,
        ]);
        processing = ctx.app.get(EsignInitiationJobService).process(job.id);
        const lock = await waitForUserLock(users[target].id);
        expect(lock.requested.startsWith('S')).toBe(true);
        expect(lock.held.startsWith('X')).toBe(true);
        await writer.commit();
        await processing;
        await mysql
          .getManager()
          .update(User, users[target].id, { isActive: true });
        expect(
          apiData<InitiationJobDto>(await get(doc, job.publicId).expect(200)),
        ).toMatchObject({
          status: 'failed',
          errorCode:
            target === 0
              ? 'ESIGN_INITIATION_CREATOR_UNAVAILABLE'
              : 'ESIGN_INITIATION_EMPLOYEE_UNAVAILABLE',
        });
        expect(
          apiData<{ status: string; signers: unknown[] }>(
            await request(ctx.server)
              .get(`/api/esign/documents/${doc}`)
              .set('Cookie', cookie)
              .expect(200),
          ),
        ).toMatchObject({ status: 'draft', signers: [] });
      } finally {
        await writer.rollback();
        await processing;
        await writer.end();
        await mysql
          .getManager()
          .update(User, users[target].id, { isActive: true });
      }
    },
  );
  it('同建立人另一文件retry與原key重播相容worker共享鎖；同文件仍防重且不洩漏', async () => {
    const first = await newDoc();
    const second = await newDoc();
    const parent = await submit(second);
    await mysql.getManager().update(EsignInitiationJob, parent.id, {
      status: 'failed',
      stage: 'failed',
      completedAt: new Date(),
      errorCode: 'ESIGN_INITIATION_TRANSIENT_FAILURE',
      retryable: true,
      attemptCount: 3,
    });
    const job = await submit(first);
    const storage = ctx.app.get<PrivateFileStorage>(PRIVATE_FILE_STORAGE);
    const original: PrivateFileStorage['openReadStream'] =
      storage.openReadStream.bind(
        storage,
      ) as PrivateFileStorage['openReadStream'];
    const entered = deferred();
    const release = deferred();
    const gate = jest
      .spyOn(storage, 'openReadStream')
      .mockImplementationOnce(async (...args) => {
        entered.resolve();
        await release.promise;
        return original(...args);
      });
    const processing = ctx.app.get(EsignInitiationJobService).process(job.id);
    try {
      await entered.promise;
      const key = randomUUID();
      const url = `/api/esign/documents/${second}/initiation-jobs/${parent.publicId}/retries`;
      const invoke = () =>
        request(ctx.server)
          .post(url)
          .set('Cookie', cookie)
          .set('Origin', origin)
          .set('Idempotency-Key', key)
          .send({})
          .timeout({ response: 2500, deadline: 2900 });
      const child = apiData<InitiationJobDto>(await invoke().expect(202));
      const row = await mysql
        .getManager()
        .findOneByOrFail(EsignInitiationJob, { publicId: child.jobId });
      ownedJobs.add(row.id);
      expect(
        apiData<InitiationJobDto>(await invoke().expect(200)),
      ).toMatchObject({ jobId: child.jobId, reused: true });
      expect(
        apiError(
          await request(ctx.server)
            .post(`/api/esign/documents/${second}/initiations`)
            .set('Cookie', cookie)
            .set('Origin', origin)
            .send(body())
            .expect(409),
        ).code,
      ).toBe('ESIGN_INITIATION_IN_PROGRESS');
      await request(ctx.server)
        .post(url)
        .set('Cookie', otherCookie)
        .set('Origin', origin)
        .set('Idempotency-Key', key)
        .send({})
        .expect(404);
    } finally {
      release.resolve();
      await processing;
      gate.mockRestore();
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
