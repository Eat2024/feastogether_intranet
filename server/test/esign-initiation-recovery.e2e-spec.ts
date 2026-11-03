import { getQueueToken } from '@nestjs/bullmq';
import { Queue, Worker } from 'bullmq';
import { ESIGN_DOCUMENT_INITIATION_QUEUE } from '#app/features/esign/esign-queue.constants';
import { InitiationJobRepository } from '#app/features/esign/repositories/initiation-job.repository';
import { EsignJobProducerService } from '#app/features/esign/services/esign-job-producer.service';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { EsignInitiationJobService } from '#app/features/esign/services/esign-initiation-job.service';
import { EsignInitiationService } from '#app/features/esign/services/esign-initiation.service';
import { EsignInitiationJob } from '#app/features/esign/entities/esign-initiation-job.entity';
import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import { DataSource } from 'typeorm';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { FeastogetherHrService } from '#app/infrastructure/http-client/feastogether/services/feastogether-hr.service';
import { apiData } from './api-response.helper';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

interface JobView {
  jobId: string;
  status: string;
  reused: boolean;
  totalCount: number;
}
describe('022 背景發起有限恢復', () => {
  jest.setTimeout(30000);
  let ctx: SecurityE2eContext;
  let db: DataSource;
  let cookie: string;
  let ownerId: string;
  const origin = 'http://localhost:3000';
  beforeAll(async () => {
    if (
      process.env.NODE_ENV !== 'test' ||
      !process.env.REDIS_DB ||
      process.env.REDIS_DB === '0'
    )
      throw new Error('恢復測試只允許隔離 test Redis DB');
    ctx = await createSecurityE2eApp((builder) =>
      builder.overrideProvider(FeastogetherHrService).useValue({
        getStaffEmails: syntheticStaffEmails,
        lookupEligibleStaff: (empid: string) =>
          Promise.resolve({
            person_empid: empid,
            person_name: '草稿測試員工',
            person_status: 1,
            person_status_name: '正式',
            department_id: 'D022',
            department_name: '測試部',
            title: '測試員工',
          }),
      }),
    );
    db = ctx.app.get<DataSource>(MYSQL_MAIN);
    cookie = await login('RC02201');
    const users = await db.query<Array<{ id: number }>>(
      "SELECT id FROM users WHERE empid='RC02201'",
    );
    ownerId = String(users[0].id);
  });
  afterAll(async () => {
    if (ctx) await closeSecurityE2eApp(ctx);
  });

  const input = () => ({
    signers: [{ type: 'user', userId: ownerId }],
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
  });
  const submit = (doc: string, body: object, key?: string, auth = cookie) => {
    const req = request(ctx.server)
      .post(`/api/esign/documents/${doc}/initiations`)
      .set('Cookie', auth)
      .set('Origin', origin);
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };
  const readJob = (doc: string, job: string, auth = cookie) =>
    request(ctx.server)
      .get(`/api/esign/documents/${doc}/initiation-jobs/${job}`)
      .set('Cookie', auth);
  async function newDoc(): Promise<string> {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    return apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', cookie)
        .set('Origin', origin)
        .field('title', '背景合成文件')
        .attach('file', Buffer.from(await pdf.save()), 'test.pdf')
        .expect(201),
    ).id;
  }

  it('暫時 DB 故障回到等待，依 30 秒退避且保留草稿 busy', async () => {
    const doc = await newDoc();
    const first = apiData<JobView>(await submit(doc, input()).expect(202));
    const row = await db.manager.findOneByOrFail(EsignInitiationJob, {
      publicId: first.jobId,
    });
    const fault = jest
      .spyOn(ctx.app.get(UserRepository), 'findByIds')
      .mockRejectedValueOnce(
        Object.assign(new Error('synthetic DB outage'), { code: 'ECONNRESET' }),
      );
    const before = Date.now();
    try {
      await ctx.app.get(EsignInitiationJobService).process(row.id);
    } finally {
      fault.mockRestore();
    }
    const result = apiData<
      JobView & {
        attemptCount: number;
        nextAttemptAt: string;
        errorCode: string;
      }
    >(await readJob(doc, first.jobId).expect(200));
    expect(result.status).toBe('queued');
    expect(result.attemptCount).toBe(1);
    expect(Date.parse(result.nextAttemptAt) - before).toBeGreaterThanOrEqual(
      30000,
    );
    expect(Date.parse(result.nextAttemptAt) - before).toBeLessThan(35000);
    expect(result.errorCode).toBe('ESIGN_INITIATION_TRANSIENT_FAILURE');
    await request(ctx.server)
      .patch(`/api/esign/documents/${doc}`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .field('title', 'blocked')
      .expect(409);
  });

  it('維護補列可靠受理且尚未送到 Redis 的工作', async () => {
    const doc = await newDoc();
    const producer = ctx.app.get(EsignJobProducerService);
    const enqueue = jest
      .spyOn(producer, 'enqueueInitiation')
      .mockResolvedValue(undefined);
    try {
      const job = apiData<JobView>(await submit(doc, input()).expect(202));
      const row = await db.manager.findOneByOrFail(EsignInitiationJob, {
        publicId: job.jobId,
      });
      enqueue.mockClear();
      await ctx.app.get(EsignInitiationJobService).maintain();
      expect(enqueue).toHaveBeenCalledWith(row.id);
      expect(
        apiData<JobView>(await readJob(doc, job.jobId).expect(200)).status,
      ).toBe('queued');
    } finally {
      enqueue.mockRestore();
    }
  });

  it('過期 lease 恢復為退避等待，舊持有者不能覆寫新狀態', async () => {
    const doc = await newDoc();
    const job = apiData<JobView>(await submit(doc, input()).expect(202));
    const row = await db.manager.findOneByOrFail(EsignInitiationJob, {
      publicId: job.jobId,
    });
    const repository = ctx.app.get(InitiationJobRepository);
    const claim = await db.transaction((m) => repository.claim(row.id, m));
    expect(claim?.leaseToken).toBeTruthy();
    await db.manager.update(EsignInitiationJob, row.id, {
      leaseExpiresAt: new Date(Date.now() - 1000),
    });
    await ctx.app.get(EsignInitiationJobService).maintain();
    expect(
      apiData<JobView>(await readJob(doc, job.jobId).expect(200)).status,
    ).toBe('queued');
    const stale = await db.transaction((m) =>
      repository.fail(
        { jobId: row.id, leaseToken: claim!.leaseToken! },
        'ESIGN_INITIATION_INTERNAL_ERROR',
        false,
        m,
      ),
    );
    expect(stale).toBeNull();
    expect(
      apiData<JobView>(await readJob(doc, job.jobId).expect(200)).status,
    ).toBe('queued');
  });

  it('單批尚未完成也獨立續租，正式交易前停止 timer', async () => {
    const doc = await newDoc();
    const job = apiData<JobView>(await submit(doc, input()).expect(202));
    const row = await db.manager.findOneByOrFail(EsignInitiationJob, {
      publicId: job.jobId,
    });
    const users = ctx.app.get(UserRepository);
    const original = users.findByIds.bind(users) as typeof users.findByIds;
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = jest
      .spyOn(users, 'findByIds')
      .mockImplementationOnce(async (...args) => {
        started();
        await held;
        return original(...args);
      });
    jest.useFakeTimers({
      doNotFake: [
        'nextTick',
        'setImmediate',
        'setTimeout',
        'performance',
        'hrtime',
      ],
    });
    const processing = ctx.app.get(EsignInitiationJobService).process(row.id);
    try {
      await entered;
      const first = await db.manager.findOneByOrFail(EsignInitiationJob, {
        id: row.id,
      });
      for (let tick = 0; tick < 12; tick++) {
        await jest.advanceTimersByTimeAsync(30000);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const renewed = await db.manager.findOneByOrFail(EsignInitiationJob, {
        id: row.id,
      });
      expect(renewed.processedCount).toBe(0);
      expect(renewed.leaseExpiresAt!.getTime()).toBeGreaterThan(
        first.leaseExpiresAt!.getTime() + 300000,
      );
    } finally {
      release();
      await processing;
      read.mockRestore();
      jest.useRealTimers();
    }
    expect(
      apiData<JobView>(await readJob(doc, job.jobId).expect(200)).status,
    ).toBe('succeeded');
  });

  it('只允許三次 claim，第二次等待 120 秒，耗盡後可辨識失敗', async () => {
    const { doc, row } = await accepted();
    const service = ctx.app.get(EsignInitiationJobService);
    const fault = jest
      .spyOn(ctx.app.get(UserRepository), 'findByIds')
      .mockRejectedValue(
        Object.assign(new Error('synthetic'), { code: 'ETIMEDOUT' }),
      );
    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const before = Date.now();
        await service.process(row.id);
        const result = await db.manager.findOneByOrFail(EsignInitiationJob, {
          id: row.id,
        });
        expect(result.attemptCount).toBe(attempt);
        if (attempt < 3) {
          expect(result.status).toBe('queued');
          const delay = attempt === 1 ? 30000 : 120000;
          expect(
            result.nextAttemptAt!.getTime() - before,
          ).toBeGreaterThanOrEqual(delay);
          expect(result.nextAttemptAt!.getTime() - before).toBeLessThan(
            delay + 5000,
          );
          await service.process(row.id);
          expect(
            (
              await db.manager.findOneByOrFail(EsignInitiationJob, {
                id: row.id,
              })
            ).attemptCount,
          ).toBe(attempt);
          await db.manager.update(EsignInitiationJob, row.id, {
            nextAttemptAt: new Date(Date.now() - 1000),
          });
        } else {
          expect(result.status).toBe('failed');
          expect(result.retryable).toBe(true);
          expect(result.errorCode).toBe('ESIGN_INITIATION_TRANSIENT_FAILURE');
        }
      }
      await service.process(row.id);
      expect(
        (await db.manager.findOneByOrFail(EsignInitiationJob, { id: row.id }))
          .attemptCount,
      ).toBe(3);
      await request(ctx.server)
        .patch(`/api/esign/documents/${doc}/draft-settings`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send({ watermark: false })
        .expect(200);
    } finally {
      fault.mockRestore();
    }
  });

  it('到期工作由 claim 或維護收斂，區分簽署截止與處理逾時', async () => {
    const service = ctx.app.get(EsignInitiationJobService);
    for (const signDeadline of [true, false]) {
      const { row } = await accepted();
      const now = new Date();
      await db.manager.update(EsignInitiationJob, row.id, {
        acceptedAt: new Date(
          now.getTime() - (signDeadline ? 3600000 : 7201000),
        ),
        deadlineAt: new Date(now.getTime() - 1000),
      });
      if (signDeadline) await service.process(row.id);
      else await service.maintain();
      const result = await db.manager.findOneByOrFail(EsignInitiationJob, {
        id: row.id,
      });
      expect(result.status).toBe('failed');
      expect(result.errorCode).toBe(
        signDeadline
          ? 'ESIGN_INITIATION_DEADLINE_PASSED'
          : 'ESIGN_INITIATION_PROCESSING_TIMEOUT',
      );
      expect(result.attemptCount).toBe(0);
    }
  });

  it('正式交易持鎖時維護跳過，成功後重送不重建指派', async () => {
    const { row, doc } = await accepted();
    const service = ctx.app.get(EsignInitiationJobService);
    const core = ctx.app.get(EsignInitiationService);
    const execute = core.initiateInTransaction.bind(
      core,
    ) as typeof core.initiateInTransaction;
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gate = jest
      .spyOn(core, 'initiateInTransaction')
      .mockImplementationOnce(async (...args) => {
        const result = await execute(...args);
        started();
        await held;
        return result;
      });
    const processing = service.process(row.id);
    let maintenance: Promise<void> | undefined;
    try {
      await entered;
      maintenance = service.maintain(new Date(Date.now() + 360000));
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          maintenance,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('maintenance blocked')),
              1000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      expect(
        apiData<JobView>(await readJob(doc, row.publicId).expect(200)).status,
      ).toBe('processing');
    } finally {
      release();
      await processing;
      await maintenance;
      gate.mockRestore();
    }
    const before = apiData<{
      status: string;
      signers: Array<{ publicId: string }>;
    }>(
      await request(ctx.server)
        .get(`/api/esign/documents/${doc}`)
        .set('Cookie', cookie)
        .expect(200),
    );
    expect(before.status).toBe('active');
    await service.process(row.id);
    const after = apiData<{ signers: Array<{ publicId: string }> }>(
      await request(ctx.server)
        .get(`/api/esign/documents/${doc}`)
        .set('Cookie', cookie)
        .expect(200),
    );
    expect(after.signers.map((s) => s.publicId)).toEqual(
      before.signers.map((s) => s.publicId),
    );
  });

  it('正式寫入後發生暫時故障全回滾，重試才建立唯一指派', async () => {
    const { row, doc } = await accepted();
    const service = ctx.app.get(EsignInitiationJobService);
    const core = ctx.app.get(EsignInitiationService);
    const execute = core.initiateInTransaction.bind(
      core,
    ) as typeof core.initiateInTransaction;
    const failure = jest
      .spyOn(core, 'initiateInTransaction')
      .mockImplementationOnce(async (...args) => {
        await execute(...args);
        throw Object.assign(new Error('synthetic deadlock'), {
          code: 'ER_LOCK_DEADLOCK',
        });
      });
    try {
      await service.process(row.id);
    } finally {
      failure.mockRestore();
    }
    expect(
      apiData<JobView>(await readJob(doc, row.publicId).expect(200)).status,
    ).toBe('queued');
    const draft = apiData<{ status: string; signers: unknown[] }>(
      await request(ctx.server)
        .get(`/api/esign/documents/${doc}`)
        .set('Cookie', cookie)
        .expect(200),
    );
    expect(draft.status).toBe('draft');
    expect(draft.signers).toHaveLength(0);
    await db.manager.update(EsignInitiationJob, row.id, {
      nextAttemptAt: new Date(Date.now() - 1000),
    });
    await service.process(row.id);
    const result = await db.manager.findOneByOrFail(EsignInitiationJob, {
      id: row.id,
    });
    expect(result.status).toBe('succeeded');
    expect(result.attemptCount).toBe(2);
  });

  it('通知派送故障不改寫已提交成功結果', async () => {
    const { row, doc } = await accepted();
    const failure = jest
      .spyOn(ctx.app.get(EsignJobProducerService), 'enqueueInvitations')
      .mockRejectedValueOnce(new Error('synthetic queue outage'));
    try {
      await ctx.app.get(EsignInitiationJobService).process(row.id);
    } finally {
      failure.mockRestore();
    }
    expect(
      apiData<JobView>(await readJob(doc, row.publicId).expect(200)).status,
    ).toBe('succeeded');
  });

  it('失去 lease 的舊 worker 不能提交或把新持有者改成失敗', async () => {
    const { row, doc } = await accepted();
    const users = ctx.app.get(UserRepository);
    const original = users.findByIds.bind(users) as typeof users.findByIds;
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gate = jest
      .spyOn(users, 'findByIds')
      .mockImplementationOnce(async (...args) => {
        started();
        await held;
        return original(...args);
      });
    const processing = ctx.app.get(EsignInitiationJobService).process(row.id);
    try {
      await entered;
      await db.manager.update(EsignInitiationJob, row.id, {
        leaseToken: randomUUID(),
      });
    } finally {
      release();
      await processing;
      gate.mockRestore();
    }
    expect(
      apiData<JobView>(await readJob(doc, row.publicId).expect(200)).status,
    ).toBe('processing');
    expect(
      apiData<{ status: string }>(
        await request(ctx.server)
          .get(`/api/esign/documents/${doc}`)
          .set('Cookie', cookie)
          .expect(200),
      ).status,
    ).toBe('draft');
  });

  it('正式交易完成前超過 deadline 會回滾，維護後呈現逾時', async () => {
    const { row, doc } = await accepted();
    const core = ctx.app.get(EsignInitiationService);
    const execute = core.initiateInTransaction.bind(
      core,
    ) as typeof core.initiateInTransaction;
    jest.useFakeTimers({
      doNotFake: [
        'nextTick',
        'setImmediate',
        'setTimeout',
        'performance',
        'hrtime',
      ],
    });
    const failure = jest
      .spyOn(core, 'initiateInTransaction')
      .mockImplementationOnce(async (...args) => {
        const result = await execute(...args);
        jest.setSystemTime(Date.now() + 121 * 60000);
        return result;
      });
    try {
      const service = ctx.app.get(EsignInitiationJobService);
      await service.process(row.id);
      await service.maintain();
    } finally {
      failure.mockRestore();
      jest.useRealTimers();
    }
    const result = await db.manager.findOneByOrFail(EsignInitiationJob, {
      id: row.id,
    });
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('ESIGN_INITIATION_PROCESSING_TIMEOUT');
    const draft = apiData<{ status: string; signers: unknown[] }>(
      await request(ctx.server)
        .get(`/api/esign/documents/${doc}`)
        .set('Cookie', cookie)
        .expect(200),
    );
    expect(draft.status).toBe('draft');
    expect(draft.signers).toHaveLength(0);
  });

  it('DB 無法保存失敗狀態時不假造終態，恢復後再回收 lease', async () => {
    const { row, doc } = await accepted();
    const service = ctx.app.get(EsignInitiationJobService);
    const repository = ctx.app.get(InitiationJobRepository);
    const source = jest
      .spyOn(ctx.app.get(UserRepository), 'findByIds')
      .mockRejectedValueOnce(
        Object.assign(new Error('synthetic'), { code: 'ECONNRESET' }),
      );
    const save = jest
      .spyOn(repository, 'fail')
      .mockRejectedValueOnce(new Error('synthetic storage outage'));
    try {
      await expect(service.process(row.id)).rejects.toThrow(
        '背景發起工作狀態暫時無法保存',
      );
    } finally {
      source.mockRestore();
      save.mockRestore();
    }
    expect(
      apiData<JobView>(await readJob(doc, row.publicId).expect(200)).status,
    ).toBe('processing');
    await db.manager.update(EsignInitiationJob, row.id, {
      leaseExpiresAt: new Date(Date.now() - 1000),
    });
    await service.maintain();
    expect(
      apiData<JobView>(await readJob(doc, row.publicId).expect(200)).status,
    ).toBe('queued');
  });

  it('已完成或失敗的 Redis delivery 不會永久阻擋下一次補列', async () => {
    const { row } = await accepted();
    const queue = ctx.app.get<Queue>(
      getQueueToken(ESIGN_DOCUMENT_INITIATION_QUEUE),
    );
    await queue.obliterate({ force: true });
    // 保留舊 terminal delivery，新的補列仍採新 delivery ID，只有 payload jobId 不變。
    const old = await queue.add(
      'synthetic-old',
      { jobId: row.id },
      { jobId: `old-${row.id}`, removeOnFail: false, removeOnComplete: false },
    );
    const worker = new Worker(
      queue.name,
      () => Promise.reject(new Error('synthetic old delivery')),
      {
        connection: {
          host: process.env.REDIS_HOST ?? '127.0.0.1',
          port: Number(process.env.REDIS_PORT),
          db: Number(process.env.REDIS_DB),
          password: process.env.REDIS_PASSWORD || undefined,
        },
        concurrency: 1,
      },
    );
    try {
      for (let i = 0; i < 100 && (await old.getState()) !== 'failed'; i++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      expect(await old.getState()).toBe('failed');
    } finally {
      await worker.close();
    }
    await ctx.app.get(EsignJobProducerService).enqueueInitiation(row.id);
    const waiting = await queue.getWaiting();
    expect(
      waiting.some(
        (delivery) =>
          delivery.id !== old.id &&
          (delivery.data as { jobId: number }).jobId === row.id,
      ),
    ).toBe(true);
    await queue.obliterate({ force: true });
  });

  async function accepted() {
    const doc = await newDoc();
    const job = apiData<JobView>(await submit(doc, input()).expect(202));
    const row = await db.manager.findOneByOrFail(EsignInitiationJob, {
      publicId: job.jobId,
    });
    return { doc, row };
  }

  async function login(empid: string): Promise<string> {
    const launched = await request(ctx.server)
      .post('/api/auth/webview-launches')
      .set('Authorization', `Bearer ${createLaunchJwt(empid)}`)
      .expect(201);
    const code = new URL(
      apiData<{ launchUrl: string }>(launched).launchUrl,
    ).searchParams.get('code');
    const response = await request(ctx.server)
      .post('/api/auth/session')
      .type('form')
      .send({ code })
      .expect(303);
    const raw: unknown = response.headers['set-cookie'];
    const value: unknown = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string') throw new Error('缺少測試 session');
    await seedSyntheticStaffEmails(ctx.app, [empid]);
    return value;
  }
});

function createLaunchJwt(empid: string): string {
  const encoded = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = encoded({ alg: 'RS256', typ: 'FT-ESIGN-LAUNCH+JWT' });
  const payload = encoded({
    iss: 'e2e-main-platform',
    aud: 'e2e-esign',
    sub: empid,
    jti: randomUUID(),
    iat: now,
    nbf: now,
    exp: now + 120,
  });
  const privateKey = createPrivateKey(
    Buffer.from(process.env.WEBVIEW_TEST_PRIVATE_KEY_B64!, 'base64').toString(
      'utf8',
    ),
  );
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(`${header}.${payload}`),
    privateKey,
  ).toString('base64url');
  return `${header}.${payload}.${signature}`;
}
import {
  syntheticStaffEmails,
  seedSyntheticStaffEmails,
} from './synthetic-staff-emails.helper';
