import { grantDocumentCreatorByEmployeeNo } from './helpers/authorization-business-fixtures';
import type { EsignDocumentListItemDto } from '#app/features/esign/dto/esign-common.dto';
import {
  createSyntheticPortal,
  type SyntheticPortal,
} from './synthetic-portal.helper';
import { InitiationJobRepository } from '#app/features/esign/repositories/initiation-job.repository';
import { EsignInitiationJobService } from '#app/features/esign/services/esign-initiation-job.service';
import { EsignAccessPolicyService } from '#app/features/esign/services/esign-access-policy.service';
import { EsignInitiationService } from '#app/features/esign/services/esign-initiation.service';
import { EsignDocument } from '#app/features/esign/entities/esign-document.entity';
import { EsignInitiationJob } from '#app/features/esign/entities/esign-initiation-job.entity';
import { createSyntheticWorker } from './security-e2e.helper';
import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import { DataSource } from 'typeorm';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';

import { apiData, apiError } from './api-response.helper';
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
describe('022 背景發起受理', () => {
  jest.setTimeout(30000);
  let ctx: SecurityE2eContext;
  let portal: SyntheticPortal;
  let db: DataSource;
  let cookie: string;
  let other: string;
  let id: string;
  let ownerId: string;
  const origin = 'http://localhost:3000';
  beforeAll(async () => {
    portal = await createSyntheticPortal();
    ctx = await createSecurityE2eApp();
    db = ctx.app.get<DataSource>(MYSQL_MAIN);
    cookie = await login('BG02201');
    other = await login('BG02202');
    const users = await db.query<Array<{ id: number }>>(
      "SELECT id FROM users WHERE empid='BG02201'",
    );
    ownerId = String(users[0].id);
    const pdf = await PDFDocument.create();
    pdf.addPage();
    id = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', cookie)
        .set('Origin', origin)
        .field('title', '草稿設定測試')
        .attach('file', Buffer.from(await pdf.save()), {
          filename: 'draft.pdf',
          contentType: 'application/pdf',
        })
        .expect(201),
    ).id;
  });
  afterAll(async () => {
    if (ctx) await closeSecurityE2eApp(ctx);
    if (portal) await portal.drop();
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
  it('既有無 key 請求先受理、不直接啟動文件，並阻擋編輯', async () => {
    const result = await request(ctx.server)
      .post(`/api/esign/documents/${id}/initiations`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send(input())
      .expect(202);
    const job = apiData<JobView>(result);
    expect(job).toMatchObject({
      status: 'queued',
      totalCount: 1,
      reused: false,
    });
    expect(result.headers.location).toContain(job.jobId);
    const busy = await request(ctx.server)
      .patch(`/api/esign/documents/${id}`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .field('title', '不能修改')
      .expect(409);
    expect(apiError(busy).code).toBe('ESIGN_INITIATION_IN_PROGRESS');
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

  it.each([1, 100])(
    '025 受理 %i 人後立即讀到期間與預計人數，重讀不需 worker',
    async (count) => {
      const doc = await newDoc();
      const oldStart = new Date(Date.now() - 86400000).toISOString();
      const oldEnd = new Date(Date.now() + 2 * 86400000).toISOString();
      await request(ctx.server)
        .patch(`/api/esign/documents/${doc}/draft-settings`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send({ signStartAt: oldStart, signEndAt: oldEnd })
        .expect(200);
      const body = {
        ...input(),
        signers: Array.from({ length: count }, (_, i) => ({
          type: 'email',
          name: `合成人員${i}`,
          email: `summary${i}@example.test`,
        })),
      };
      await submit(doc, body).expect(202);
      for (let read = 0; read < 2; read++) {
        const response = await request(ctx.server)
          .get('/api/esign/documents?role=created')
          .set('Cookie', cookie)
          .expect(200);
        const row = apiData<EsignDocumentListItemDto[]>(response).find(
          (item) => item.id === doc,
        );
        expect(row).toMatchObject({
          status: 'initiating',
          signStartAt: oldStart,
          signEndAt: oldEnd,
          signedCount: 0,
          pendingCount: 0,
          initiation: {
            signStartAt: body.signStartAt,
            signEndAt: body.signEndAt,
            totalCount: count,
          },
        });
      }
    },
  );

  it('025 未通過受理的文件不產生發起摘要', async () => {
    const doc = await newDoc();
    await submit(doc, { ...input(), signers: [] }).expect(400);
    const response = await request(ctx.server)
      .get('/api/esign/documents?role=created')
      .set('Cookie', cookie)
      .expect(200);
    expect(
      apiData<EsignDocumentListItemDto[]>(response).find(
        (item) => item.id === doc,
      ),
    ).toMatchObject({ status: 'draft', initiation: null });
  });

  it('有 key 重播原摘要，改內容或無 key 再送衝突，非建立人不能查', async () => {
    const doc = await newDoc();
    const body = input();
    const key = randomUUID();
    const first = apiData<JobView>(await submit(doc, body, key).expect(202));
    const replay = apiData<JobView>(await submit(doc, body, key).expect(200));
    expect(replay).toMatchObject({
      jobId: first.jobId,
      reused: true,
      status: 'queued',
    });
    await submit(doc, { ...body, watermark: false }, key).expect(409);
    await submit(doc, body).expect(409);
    await submit(doc, body, 'not-a-uuid').expect(400);
    await readJob(doc, first.jobId, other).expect(404);
    await request(ctx.server)
      .get(`/api/esign/documents/${doc}/initiation-jobs/${first.jobId}`)
      .expect(401);
    const summary = await readJob(doc, first.jobId).expect(200);
    expect(summary.headers['cache-control']).toBe('private, no-store');
    expect(apiData<Record<string, unknown>>(summary)).not.toHaveProperty(
      'inputJson',
    );
  });

  it.each(['queued', 'processing'])(
    '%s 所有文件與簽署人寫入均回 busy，直接鎖文件的入口也不能繞過',
    async (status) => {
      const doc = await newDoc();
      const saved = apiData<{ signers: Array<{ publicId: string }> }>(
        await request(ctx.server)
          .patch(`/api/esign/documents/${doc}/draft-settings`)
          .set('Cookie', cookie)
          .set('Origin', origin)
          .send({ signers: [{ type: 'user', userId: ownerId }] })
          .expect(200),
      );
      const accepted = apiData<JobView>(await submit(doc, input()).expect(202));
      if (status === 'processing') {
        const job = await db.manager.findOneByOrFail(EsignInitiationJob, {
          publicId: accepted.jobId,
        });
        await db.transaction((manager) =>
          ctx.app.get(InitiationJobRepository).claim(job.id, manager),
        );
      }
      const replacement = await PDFDocument.create();
      replacement.addPage();
      const replacementBytes = Buffer.from(await replacement.save());
      const checks = [
        () =>
          request(ctx.server)
            .patch(`/api/esign/documents/${doc}`)
            .attach('file', replacementBytes, {
              filename: 'replacement.pdf',
              contentType: 'application/pdf',
            }),
        () =>
          request(ctx.server)
            .patch(`/api/esign/documents/${doc}`)
            .field('title', '不得改標題'),
        () =>
          request(ctx.server)
            .post(`/api/esign/documents/${doc}/stoppages`)
            .send({ reason: '合成停止原因' }),
        () =>
          request(ctx.server)
            .post(`/api/esign/documents/${doc}/reopenings`)
            .send({
              expectedSignEndAt: input().signEndAt,
              signEndAt: new Date(Date.now() + 172800000).toISOString(),
              reason: '合成補簽原因',
            }),
        () =>
          request(ctx.server)
            .post(`/api/esign/documents/${doc}/notification-batches`)
            .send({ selection: 'all_pending', requestId: randomUUID() }),
        () =>
          request(ctx.server)
            .patch(`/api/esign/documents/${doc}/draft-settings`)
            .send({
              signStartAt: input().signStartAt,
              signEndAt: input().signEndAt,
              allowReject: true,
            }),
        () =>
          request(ctx.server)
            .patch(`/api/esign/documents/${doc}/draft-settings`)
            .send({
              signers: [
                {
                  type: 'email',
                  name: '替換名單',
                  email: 'replace@example.invalid',
                },
              ],
            }),
        () => request(ctx.server).delete(`/api/esign/documents/${doc}`),
        () =>
          request(ctx.server)
            .patch(`/api/esign/documents/${doc}/draft-settings`)
            .send({ watermark: false }),
        () =>
          request(ctx.server)
            .put(`/api/esign/documents/${doc}/draftSave`)
            .send({ signers: [{ type: 'user', userId: ownerId }] }),
        () =>
          request(ctx.server)
            .put(`/api/esign/documents/${doc}/fields`)
            .send({ fields: input().fields }),
        () =>
          request(ctx.server)
            .patch(
              `/api/esign/documents/${doc}/signers/${saved.signers[0].publicId}/note`,
            )
            .send({ note: '不可修改' }),
      ];
      for (const make of checks) {
        const result = await make()
          .set('Cookie', cookie)
          .set('Origin', origin)
          .expect(409);
        expect(apiError(result)).toMatchObject({
          code: 'ESIGN_INITIATION_IN_PROGRESS',
          message:
            '文件正在背景發起中（worker 執行中），暫時無法修改文件或簽署人，請稍後再試。',
        });
        const denied = await make()
          .set('Cookie', other)
          .set('Origin', origin)
          .expect(404);
        expect(apiError(denied).code).not.toBe('ESIGN_INITIATION_IN_PROGRESS');
      }
    },
  );

  it('RR 舊快照不會讓受理後的草稿異動繞過保護', async () => {
    const doc = await newDoc();
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.manager.find(EsignInitiationJob, {
        where: { documentId: Number(doc) },
      });
      await submit(doc, input()).expect(202);
      await expect(
        ctx.app
          .get(EsignAccessPolicyService)
          .checkAndLockDraftDoc(Number(doc), Number(ownerId), runner.manager),
      ).rejects.toMatchObject({ code: 'ESIGN_INITIATION_IN_PROGRESS' });
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });

  it('相同 key 與不同 key 並行最多建立一個工作', async () => {
    const doc = await newDoc();
    const body = input();
    const key = randomUUID();
    const replies = await Promise.all([
      submit(doc, body, key),
      submit(doc, body, key),
    ]);
    expect(replies.map((x) => x.status).sort()).toEqual([200, 202]);
    expect(apiData<JobView>(replies[0]).jobId).toBe(
      apiData<JobView>(replies[1]).jobId,
    );
    const otherDoc = await newDoc();
    const conflicts = await Promise.all([
      submit(otherDoc, body, randomUUID()),
      submit(otherDoc, body, randomUUID()),
    ]);
    expect(conflicts.map((x) => x.status).sort()).toEqual([202, 409]);
  });

  it('processing 期間拒絕修改，業務與成功同次提交且重送不雙發', async () => {
    const doc = await newDoc();
    const body = input();
    const key = randomUUID();
    const job = apiData<JobView>(await submit(doc, body, key).expect(202));
    const row = await db.manager.findOneByOrFail(EsignInitiationJob, {
      publicId: job.jobId,
    });
    const core = ctx.app.get(EsignInitiationService);
    const execute = core.initiateInTransaction.bind(
      core,
    ) as typeof core.initiateInTransaction;
    let entered!: () => void;
    const claimed = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = jest
      .spyOn(core, 'initiateInTransaction')
      .mockImplementation(async (...args) => {
        entered();
        await gate;
        return execute(...args);
      });
    const processing = ctx.app.get(EsignInitiationJobService).process(row.id);
    try {
      await claimed;
      expect(
        apiData<JobView>(await readJob(doc, job.jobId).expect(200)).status,
      ).toBe('processing');
      await request(ctx.server)
        .patch(`/api/esign/documents/${doc}/draft-settings`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send({ watermark: false })
        .expect(409);
    } finally {
      release();
      await processing;
      spy.mockRestore();
    }
    expect(
      apiData<JobView>(await readJob(doc, job.jobId).expect(200)).status,
    ).toBe('succeeded');
    expect(
      (await db.manager.findOneByOrFail(EsignDocument, { id: Number(doc) }))
        .status,
    ).toBe('active');
    await ctx.app.get(EsignInitiationJobService).process(row.id);
    expect(
      apiData<JobView>(await submit(doc, body, key).expect(200)).jobId,
    ).toBe(job.jobId);
    await submit(doc, body).expect(409);
  });

  it('截止已過仍可用原 key 重播，不重新套用新受理驗證', async () => {
    const doc = await newDoc();
    const key = randomUUID();
    const body = {
      ...input(),
      signEndAt: new Date(Date.now() + 500).toISOString(),
    };
    const original = apiData<JobView>(await submit(doc, body, key).expect(202));
    await new Promise((resolve) => setTimeout(resolve, 550));
    const replay = apiData<JobView>(await submit(doc, body, key).expect(200));
    expect(replay.jobId).toBe(original.jobId);
  });

  it('員編表示由 worker 解析本機帳號，不更動草稿 DTO', async () => {
    const doc = await newDoc();
    const body = {
      ...input(),
      signers: [{ type: 'employee', employeeNo: 'BG02201' }],
    };
    const job = apiData<JobView>(await submit(doc, body).expect(202));
    const row = await db.manager.findOneByOrFail(EsignInitiationJob, {
      publicId: job.jobId,
    });
    await ctx.app.get(EsignInitiationJobService).process(row.id);
    expect(
      apiData<JobView>(await readJob(doc, job.jobId).expect(200)).status,
    ).toBe('succeeded');
    await submit(await newDoc(), {
      ...body,
      signers: [...body.signers, { type: 'user', userId: ownerId }],
    }).expect(400);
  });

  it('正式核心後發生錯誤會全回滾，failed 後才允許再修改', async () => {
    const doc = await newDoc();
    const job = apiData<JobView>(await submit(doc, input()).expect(202));
    const row = await db.manager.findOneByOrFail(EsignInitiationJob, {
      publicId: job.jobId,
    });
    const core = ctx.app.get(EsignInitiationService);
    const execute = core.initiateInTransaction.bind(
      core,
    ) as typeof core.initiateInTransaction;
    const spy = jest
      .spyOn(core, 'initiateInTransaction')
      .mockImplementationOnce(async (...args) => {
        await execute(...args);
        throw new Error('synthetic rollback');
      });
    try {
      await ctx.app.get(EsignInitiationJobService).process(row.id);
    } finally {
      spy.mockRestore();
    }
    expect(
      apiData<JobView>(await readJob(doc, job.jobId).expect(200)).status,
    ).toBe('failed');
    const detail = apiData<{ status: string; signers: unknown[] }>(
      await request(ctx.server)
        .get(`/api/esign/documents/${doc}`)
        .set('Cookie', cookie)
        .expect(200),
    );
    expect(detail.status).toBe('draft');
    expect(detail.signers).toHaveLength(0);
    await request(ctx.server)
      .patch(`/api/esign/documents/${doc}/draft-settings`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({ watermark: false })
      .expect(200);
  });

  it('真 queue worker 能完成受理工作，HTTP 程序不執行正式發起', async () => {
    const doc = await newDoc();
    const job = apiData<JobView>(await submit(doc, input()).expect(202));
    const worker = await createSyntheticWorker(ctx);
    try {
      const deadline = Date.now() + 20000;
      let status = 'queued';
      while (Date.now() < deadline) {
        status = apiData<JobView>(
          await readJob(doc, job.jobId).expect(200),
        ).status;
        if (status === 'succeeded' || status === 'failed') break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(status).toBe('succeeded');
    } finally {
      await worker.close();
    }
  });

  async function login(empid: string): Promise<string> {
    await portal.insertPeople([
      {
        person_empid: empid,
        person_name: '背景合成員工',
        person_status: 1,
        department_id: 'D022',
        department_name: '測試部',
        title: '測試員工',
        email: `${empid.toLowerCase()}@example.test`,
      },
    ]);
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
    await grantDocumentCreatorByEmployeeNo(ctx.app, empid);
    const raw: unknown = response.headers['set-cookie'];
    const value: unknown = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string') throw new Error('缺少測試 session');
    await Promise.all(
      [empid].map((employeeNo) =>
        ctx.app
          .get<DataSource>(MYSQL_MAIN)
          .query('UPDATE users SET email=? WHERE empid=?', [
            `${employeeNo.toLowerCase()}@example.test`,
            employeeNo,
          ]),
      ),
    );
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
