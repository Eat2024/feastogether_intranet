import { grantDocumentCreator } from './helpers/authorization-business-fixtures';
import { createSyntheticPortal, type SyntheticPortal } from './synthetic-portal.helper';
import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplicationContext } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import { DataSource } from 'typeorm';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';

import { EsignInitiationJobService } from '#app/features/esign/services/esign-initiation-job.service';
import { EsignJobProducerService } from '#app/features/esign/services/esign-job-producer.service';
import {
  ESIGN_MAINTENANCE_QUEUE,
  ESIGN_DOCUMENT_INITIATION_QUEUE,
} from '#app/features/esign/esign-queue.constants';
import { EsignMaintenanceProcessor } from '#app/worker/esign/esign-maintenance.processor';
import { EsignMaintenanceScheduler } from '#app/worker/esign/esign-maintenance.scheduler';
import { apiData } from './api-response.helper';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
  createSyntheticWorker,
  type SecurityE2eContext,
} from './security-e2e.helper';

// 明確限定本機專用 DB 9；不能對一般 e2e Redis 或共享 DB 做破壞性故障注入。
const reconnectSuite =
  process.env.DB_MYSQL_DB === 'feastogether_intranet_test022_reconnect'
    ? describe
    : describe.skip;
reconnectSuite('022 Redis metadata 遺失後同程序恢復', () => {
  jest.setTimeout(70_000);
  let ctx: SecurityE2eContext;
  let portal: SyntheticPortal;
  let redis: Redis;
  let cookie: string;
  let ownerId: string;
  const workers: INestApplicationContext[] = [];
  const origin = 'http://localhost:3000';
  beforeAll(async () => {
    if (
      process.env.NODE_ENV !== 'test' ||
      process.env.REDIS_DB !== '9' ||
      process.env.REDIS_HOST !== '127.0.0.1' ||
      process.env.REDIS_PORT !== '16322' ||
      process.env.DB_MYSQL_DB !== 'feastogether_intranet_test022_reconnect'
    ) {
      throw new Error(
        '重連故障測試僅允許專用本機 test022_reconnect / Redis 16322 DB 9',
      );
    }
    redis = new Redis({ host: '127.0.0.1', port: 16322, db: 9 });
    await redis.flushdb();
    portal = await createSyntheticPortal();
    ctx = await createSecurityE2eApp();
    cookie = await login('RC02201');
    const db = ctx.app.get<DataSource>(MYSQL_MAIN);
    const users = await db.query<Array<{ id: number }>>(
      "SELECT id FROM users WHERE empid='RC02201'",
    );
    ownerId = String(users[0].id);
    await grantDocumentCreator(ctx.app, users[0].id);
  });
  afterAll(async () => {
    await Promise.all(workers.map((worker) => worker.close()));
    if (ctx) await closeSecurityE2eApp(ctx);
    if (portal) await portal.drop();
    if (redis) await redis.quit();
  });

  async function submit() {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const doc = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', cookie)
        .set('Origin', origin)
        .field('title', '合成重連文件')
        .attach('file', Buffer.from(await pdf.save()), 'test.pdf')
        .expect(201),
    ).id;
    const job = apiData<{ jobId: string }>(
      await request(ctx.server)
        .post(`/api/esign/documents/${doc}/initiations`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send({
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
          signStartAt: new Date(Date.now() - 60_000).toISOString(),
          signEndAt: new Date(Date.now() + 86400_000).toISOString(),
          watermark: true,
          allowReject: false,
        })
        .expect(202),
    );
    return { doc, job: job.jobId };
  }
  const read = async (item: { doc: string; job: string }) =>
    apiData<{ status: string; processedCount: number }>(
      await request(ctx.server)
        .get(`/api/esign/documents/${item.doc}/initiation-jobs/${item.job}`)
        .set('Cookie', cookie)
        .expect(200),
    );
  async function until(condition: () => Promise<boolean>, timeout = 45_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('重連恢復未在測試期限內完成');
  }

  it('啟動先配置；雙 worker 不重啟即可恢復 scheduler/global1 並完成遺失 delivery 的 DB 工作', async () => {
    const one = await submit();
    const two = await submit();
    // 真 consumer 啟動 gate：即使已有 delivery，global 設定尚未完成不得 claim。
    const q = ctx.app.get<Queue>(
      getQueueToken(ESIGN_DOCUMENT_INITIATION_QUEUE),
    );
    // 保存原方法，以下以 .call(this) 保留 Queue receiver。
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalSet = Queue.prototype.setGlobalConcurrency;
    let release!: () => void;
    let entered!: () => void;
    const configuring = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const config = jest
      .spyOn(Queue.prototype, 'setGlobalConcurrency')
      .mockImplementation(async function (this: Queue, count: number) {
        if (this.name === ESIGN_DOCUMENT_INITIATION_QUEUE) {
          entered();
          await gate;
        }
        await originalSet.call(this, count);
      });
    const starting = createSyntheticWorker(ctx);
    try {
      await configuring;
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect((await read(one)).status).toBe('queued');
    } finally {
      release();
      config.mockRestore();
      workers.push(await starting);
    }
    workers.push(await createSyntheticWorker(ctx));
    // 停既有 maintenance consumer，固定故障注入點；不停止 initiation worker 程序。
    await Promise.all(
      workers.map((w) =>
        w
          .get<EsignMaintenanceProcessor>(EsignMaintenanceProcessor)
          .worker.pause(),
      ),
    );
    await until(
      async () =>
        (await read(one)).status === 'succeeded' &&
        (await read(two)).status === 'succeeded' &&
        (await q.getActiveCount()) === 0,
    );
    const lost = jest
      .spyOn(ctx.app.get(EsignJobProducerService), 'enqueueInitiation')
      .mockResolvedValue(undefined);
    const pending = [await submit(), await submit()];
    lost.mockRestore();
    expect((await read(pending[0])).status).toBe('queued');
    await redis.flushdb();
    expect(await q.getGlobalConcurrency()).toBeNull();
    let recovered!: () => void;
    const configuringAgain = new Promise<void>((resolve) => {
      recovered = resolve;
    });
    let allowRecovery!: () => void;
    const recoveryGate = new Promise<void>((resolve) => {
      allowRecovery = resolve;
    });
    const recoveryConfig = jest
      .spyOn(Queue.prototype, 'setGlobalConcurrency')
      .mockImplementation(async function (this: Queue, count: number) {
        if (this.name === ESIGN_DOCUMENT_INITIATION_QUEUE) {
          recovered();
          await recoveryGate;
        }
        await originalSet.call(this, count);
      });
    // 只 kill DB 9 的連線；其他 DB 的 worker 不受影響。admin 自己不斷線。
    const adminId = String(await redis.call('CLIENT', 'ID'));
    const clients = String(await redis.client('LIST'))
      .split('\n')
      .map((line) =>
        Object.fromEntries<string>(
          line.split(' ').map((field) => field.split('=')),
        ),
      );
    for (const client of clients) {
      if (client.db === '9' && client.id !== adminId)
        await redis.call('CLIENT', 'KILL', 'ID', client.id);
    }
    try {
      await configuringAgain;
      await until(
        async () =>
          (await q.client).status === 'ready' &&
          workers.every(
            (w) =>
              !w.get<EsignMaintenanceScheduler>(EsignMaintenanceScheduler)
                .ready,
          ),
      );
      const db = ctx.app.get<DataSource>(MYSQL_MAIN);
      const rows = await db.query<Array<{ id: number }>>(
        'SELECT id FROM esign_initiation_jobs WHERE public_id IN (?, ?)',
        pending.map((item) => item.job),
      );
      for (const row of rows)
        await ctx.app.get(EsignJobProducerService).enqueueInitiation(row.id);
      await until(
        async () =>
          (await q.getWaitingCount()) === 0 && (await q.getActiveCount()) === 0,
      );
      expect(
        (await Promise.all(pending.map(read))).map((j) => j.status),
      ).toEqual(['queued', 'queued']);
    } finally {
      allowRecovery();
      recoveryConfig.mockRestore();
    }
    const maintenance = workers[0].get<Queue>(
      getQueueToken(ESIGN_MAINTENANCE_QUEUE),
    );
    await until(
      async () =>
        workers.every(
          (w) =>
            w.get<EsignMaintenanceScheduler>(EsignMaintenanceScheduler).ready,
        ) &&
        (await q.getGlobalConcurrency()) === 1 &&
        (await maintenance.getJobSchedulers()).length === 1,
    );
    let active = 0;
    let maxActive = 0;
    const spies = workers.map((w) => {
      const service = w.get<EsignInitiationJobService>(
        EsignInitiationJobService,
      );
      const process = service.process.bind(service) as typeof service.process;
      return jest.spyOn(service, 'process').mockImplementation(async (id) => {
        active++;
        maxActive = Math.max(maxActive, active);
        try {
          await new Promise((resolve) => setTimeout(resolve, 100));
          await process(id);
        } finally {
          active--;
        }
      });
    });
    for (const w of workers)
      w.get<EsignMaintenanceProcessor>(
        EsignMaintenanceProcessor,
      ).worker.resume();
    await until(async () =>
      (await Promise.all(pending.map(read))).every(
        (j) => j.status === 'succeeded',
      ),
    );
    expect(maxActive).toBe(1); // 僅主張配置恢復後的新工作；不是 metadata loss 前已在途的極端窗口。
    expect(await maintenance.getJobSchedulers()).toHaveLength(1);
    for (const spy of spies) spy.mockRestore();
    await until(
      async () =>
        (await read(one)).status === 'succeeded' &&
        (await read(two)).status === 'succeeded',
    );
  });
  async function login(empid: string): Promise<string> {
    await portal.insertPeople([{ person_empid: empid, person_name: '背景合成員工', person_status: 1, department_id: 'D022', department_name: '測試部', title: '測試員工', email: `${empid.toLowerCase()}@example.test` }]);
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
    await Promise.all([empid].map((employeeNo) => ctx.app.get<DataSource>(MYSQL_MAIN).query('UPDATE users SET email=? WHERE empid=?', [`${employeeNo.toLowerCase()}@example.test`, employeeNo])));
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

