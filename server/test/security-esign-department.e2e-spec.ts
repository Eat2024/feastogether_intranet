import { AuthorizationUserRole } from '#app/features/authorization/entities/authorization-user-role.entity';
import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { In } from 'typeorm';
import { User } from '#app/features/users/entities/user.entity';
import { AuthSession } from '#app/features/auth/entities/auth-session.entity';
import { EsignDocument } from '#app/features/esign/entities/esign-document.entity';
import { EsignExportJob } from '#app/features/esign/entities/esign-export-job.entity';
import { EsignFileObject } from '#app/features/esign/entities/esign-file-object.entity';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { EsignSigner } from '#app/features/esign/entities/esign-signer.entity';
import { EsignNotificationBatch } from '#app/features/esign/entities/esign-notification-batch.entity';
import {
  ESIGN_EXTERNAL_INVITATION_QUEUE,
  ESIGN_DOCUMENT_FINALIZATION_QUEUE,
  ESIGN_EXPORT_QUEUE,
} from '#app/features/esign/esign-queue.constants';
import { createDepartmentFixtures } from './department-visibility.helper';
import { apiData, apiError } from './api-response.helper';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

const origin = 'http://localhost:3000';

describe('Spec017 部門管理安全邊界', () => {
  let ctx: SecurityE2eContext;
  let fixture: Awaited<ReturnType<typeof createDepartmentFixtures>>;
  let document: EsignDocument;
  let signer: EsignSigner;
  let path: string;
  beforeAll(async () => {
    ctx = await createSecurityE2eApp();
    fixture = await createDepartmentFixtures(ctx, 'document_creator');
    document = await fixture.createDocument(fixture.users.a1);
    signer = await fixture.manager.save(
      EsignSigner,
      fixture.manager.create(EsignSigner, {
        publicId: randomUUID(),
        documentId: document.id,
        signerType: 'email',
        nameSnapshot: '合成簽署人',
        email: 'private017@example.test',
        status: 'pending',
        sortOrder: 0,
        note: '不可外洩管理備註',
        rejectReason: '不可外洩個別理由',
      }),
    );
    path = `/api/esign/documents/${document.id}`;
  });
  afterAll(async () => {
    if (fixture) {
      const manager = fixture.manager;
      if (document) {
        await manager.delete(EsignSigner, { documentId: document.id });
        await manager.delete(EsignDocument, { id: document.id });
      }
      const ids = Object.values(fixture.users).map((user) => user.id);
      await manager.delete(AuthorizationUserRole, {
        userId: In(Object.values(fixture.users).map((u) => u.id)),
      });
      await manager.delete(AuthSession, { userId: In(ids) });
      await manager.delete(User, { id: In(ids) });
    }
    if (ctx) await closeSecurityE2eApp(ctx);
  });

  it('同部門唯讀回應不含管理／邀請／個資欄位，仍能查看草稿', async () => {
    const response = await request(ctx.server)
      .get(path)
      .set('Cookie', fixture.cookies.a2)
      .expect(200);
    const detail = apiData<{
      isCreator: boolean;
      status: string;
      signers: Record<string, unknown>[];
    }>(response);
    expect(detail.isCreator).toBe(false);
    expect(detail.status).toBe('draft');
    expect(Object.keys(detail.signers[0]).sort()).toEqual([
      'name',
      'publicId',
      'rejectedAt',
      'signedAt',
      'status',
    ]);
    for (const forbidden of [
      'private017@example.test',
      '不可外洩管理備註',
      '不可外洩個別理由',
      'invitationToken',
      'objectKey',
      'verificationUrl',
    ]) {
      expect(JSON.stringify(detail)).not.toContain(forbidden);
    }
  });

  it('未知全公司與偽造部門參數拒絕；未登入401，缺部門409', async () => {
    for (const query of [
      'role=all',
      'role=dep&departmentCode=B001',
      'role=dep&departmentId=1',
    ]) {
      await request(ctx.server)
        .get(`/api/esign/documents?${query}`)
        .set('Cookie', fixture.cookies.a2)
        .expect(400);
    }
    await request(ctx.server).get('/api/esign/documents?role=dep').expect(401);
    const missing = await request(ctx.server)
      .get('/api/esign/documents?role=dep')
      .set('Cookie', fixture.cookies.missing)
      .expect(409);
    expect(apiError(missing).code).toBe('ESIGN_DEPARTMENT_UNAVAILABLE');
  });

  it('跨部門、同名異碼及來源直接ID均拒絕，不洩漏資源存在性', async () => {
    for (const cookie of [fixture.cookies.b1, fixture.cookies.sameName]) {
      for (const suffix of ['', '/source-file']) {
        await request(ctx.server)
          .get(path + suffix)
          .set('Cookie', cookie)
          .expect(404);
      }
    }
  });

  it('同部門非建立人不能透過管理GET、編輯、發起、停止、補簽或通知寫入', async () => {
    const { manager, cookies } = fixture;
    const queues = [
      ESIGN_EXTERNAL_INVITATION_QUEUE,
      ESIGN_DOCUMENT_FINALIZATION_QUEUE,
      ESIGN_EXPORT_QUEUE,
    ].map((name) => ctx.app.get<Queue>(getQueueToken(name)));
    const queueBefore = await Promise.all(
      queues.map((queue) => queue.getJobCounts()),
    );
    const before = await manager.findOneByOrFail(EsignDocument, {
      id: document.id,
    });
    const beforeSigner = await manager.findOneByOrFail(EsignSigner, {
      id: signer.id,
    });
    const batchesBefore = await manager.count(EsignNotificationBatch, {
      where: { documentId: document.id },
    });
    const calls: Array<{
      method: 'patch' | 'put' | 'post' | 'delete' | 'get';
      suffix: string;
      body?: object;
    }> = [
      { method: 'patch', suffix: '', body: { title: '不應修改' } },
      { method: 'delete', suffix: '' },
      { method: 'patch', suffix: '/draft-settings', body: { watermark: true } },
      {
        method: 'put',
        suffix: '/draftSave',
        body: {
          signers: [
            { type: 'email', name: '合成人', email: 'new017@example.test' },
          ],
        },
      },
      { method: 'put', suffix: '/fields', body: { fields: [] } },
      {
        method: 'post',
        suffix: '/employee-email-checks',
        body: { userIds: [String(fixture.users.a2.id)] },
      },
      {
        method: 'post',
        suffix: '/initiations',
        body: {
          signers: [
            { type: 'email', name: '合成人', email: 'new017@example.test' },
          ],
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
          watermark: false,
          allowReject: false,
        },
      },
      { method: 'post', suffix: '/stoppages', body: { reason: '不應停止' } },
      {
        method: 'post',
        suffix: '/reopenings',
        body: {
          expectedSignEndAt: new Date().toISOString(),
          signEndAt: new Date(Date.now() + 86400000).toISOString(),
          reason: '不應補簽',
        },
      },
      {
        method: 'patch',
        suffix: `/signers/${signer.publicId}/note`,
        body: { note: '不應修改' },
      },
      {
        method: 'post',
        suffix: '/notification-batches',
        body: { requestId: randomUUID(), selection: 'all_pending' },
      },
      { method: 'get', suffix: '/notification-batches' },
      { method: 'get', suffix: `/notification-batches/${randomUUID()}` },
      { method: 'get', suffix: '/reopening-invitations' },
    ];
    for (const call of calls) {
      const req = request(ctx.server)
        [call.method](path + call.suffix)
        .set('Cookie', cookies.a2)
        .set('Origin', origin);
      if (call.method === 'patch' && call.suffix === '')
        req.field('title', '不應修改');
      else if (call.body) req.send(call.body);
      const response = await req;
      expect({
        method: call.method,
        suffix: call.suffix,
        status: response.status,
      }).toEqual({ method: call.method, suffix: call.suffix, status: 404 });
    }
    expect(
      await manager.findOneByOrFail(EsignDocument, { id: document.id }),
    ).toEqual(before);
    expect(
      await manager.findOneByOrFail(EsignSigner, { id: signer.id }),
    ).toEqual(beforeSigner);
    expect(
      await manager.count(EsignNotificationBatch, {
        where: { documentId: document.id },
      }),
    ).toBe(batchesBefore);
    expect(
      await Promise.all(queues.map((queue) => queue.getJobCounts())),
    ).toEqual(queueBefore);
  });
});

/** 使用真實 guard／repository 與合成資源，驗證授權早於查檔、寫紀錄及排入工作。 */
describe('Spec017 一般匯出直接網址安全邊界', () => {
  let ctx: SecurityE2eContext;
  let fixture: Awaited<ReturnType<typeof createDepartmentFixtures>>;
  const documents: EsignDocument[] = [];
  const signers: EsignSigner[] = [];
  const zipJobs: EsignExportJob[] = [];
  const zipFiles: EsignFileObject[] = [];
  let excel: EsignExportJob;
  let pdf: EsignExportJob;

  interface Route {
    method: 'get' | 'post';
    path: string;
    body?: object;
    range?: boolean;
  }

  beforeAll(async () => {
    ctx = await createSecurityE2eApp();
    fixture = await createDepartmentFixtures(ctx, 'document_creator');
    const { manager, users } = fixture;
    for (let index = 0; index < 2; index += 1) {
      const document = await fixture.createDocument(users.a1, {
        title: `合成匯出安全文件-${randomUUID()}`,
        status: 'active',
        signStartAt: new Date(Date.now() - 60_000),
        signEndAt: new Date(Date.now() + 86_400_000),
      });
      documents.push(document);
      const signer = await manager.save(
        EsignSigner,
        manager.create(EsignSigner, {
          publicId: randomUUID(),
          documentId: document.id,
          signerType: 'email',
          nameSnapshot: '合成匯出簽署人',
          email: 'export-private017@example.test',
          status: 'signed',
          signedAt: new Date(),
          completionStatus: 'pending',
          sortOrder: 0,
          note: '不得揭露的匯出管理備註',
        }),
      );
      signers.push(signer);
      const job = await manager.save(
        EsignExportJob,
        manager.create(EsignExportJob, {
          publicId: randomUUID(),
          documentId: document.id,
          createdByUserId: users.a1.id,
          exportType: 'signed_copies_zip',
          status: 'completed',
          scopeDescription: '合成 ZIP',
          snapshotAt: new Date(),
          snapshotJson: [],
          recordCount: 1,
          completedAt: new Date(),
          expiresAt: new Date(Date.now() + 86_400_000),
        }),
      );
      zipJobs.push(job);
      zipFiles.push(
        await manager.save(
          EsignFileObject,
          manager.create(EsignFileObject, {
            exportJobId: job.id,
            filePurpose: 'signed_copies_zip',
            objectKey: `spec017-security/${randomUUID()}.zip`,
            originalFileName: '合成不可讀檔.zip',
            mimeType: 'application/zip',
            fileSize: 16,
            sha256: 'a'.repeat(64),
          }),
        ),
      );
    }
    excel = await manager.save(
      EsignExportJob,
      manager.create(EsignExportJob, {
        publicId: randomUUID(),
        documentId: documents[0].id,
        createdByUserId: users.a1.id,
        exportType: 'excel',
        status: 'completed',
        scopeDescription: '合成 Excel',
        recordCount: 1,
        conditionsJson: { statuses: [], depts: [], fields: ['name'] },
        completedAt: new Date(),
      }),
    );
    pdf = await manager.save(
      EsignExportJob,
      manager.create(EsignExportJob, {
        publicId: randomUUID(),
        documentId: documents[0].id,
        createdByUserId: null,
        signerId: signers[0].id,
        exportType: 'pdf',
        status: 'completed',
        scopeDescription: '合成外部本人 PDF 紀錄',
        recordCount: 1,
        completedAt: new Date(),
      }),
    );
  });

  afterAll(async () => {
    if (fixture) {
      const { manager, users } = fixture;
      const documentIds = documents.map((document) => document.id);
      const jobs = await manager.find(EsignExportJob, {
        where: { documentId: In(documentIds) },
      });
      if (jobs.length)
        await manager.delete(EsignFileObject, {
          exportJobId: In(jobs.map((job) => job.id)),
        });
      await manager.delete(EsignExportJob, { documentId: In(documentIds) });
      await manager.delete(EsignSigner, { documentId: In(documentIds) });
      await manager.delete(EsignDocument, { id: In(documentIds) });
      const userIds = Object.values(users).map((user) => user.id);
      await manager.delete(AuthorizationUserRole, {
        userId: In(Object.values(fixture.users).map((u) => u.id)),
      });
      await manager.delete(AuthSession, { userId: In(userIds) });
      await manager.delete(User, { id: In(userIds) });
    }
    if (ctx) await closeSecurityE2eApp(ctx);
  });

  const documentPath = (index = 0) =>
    `/api/esign/documents/${documents[index].id}`;
  const zipPath = (documentIndex = 0, jobIndex = 0) =>
    `${documentPath(documentIndex)}/exports/${zipJobs[jobIndex].publicId}`;
  const historyPath = (type: string) =>
    `/api/esign/history/export?type=${type}&documentId=${documents[0].id}`;
  const listPath = () =>
    `/api/esign/exportable-documents?q=${encodeURIComponent(documents[0].title)}`;
  const excelBody = () => ({
    type: 'excel',
    documentId: String(documents[0].id),
    scope: '全部',
    count: 1,
    conditions: { statuses: [], depts: [], fields: ['name'] },
  });
  const directRoutes = (): Route[] => [
    { method: 'get', path: `${documentPath()}?view=export` },
    {
      method: 'post',
      path: `${documentPath()}/exports`,
      body: { type: 'signed_copies_zip' },
    },
    { method: 'get', path: zipPath() },
    { method: 'post', path: `${zipPath()}/retries` },
    {
      method: 'get',
      path: `${zipPath()}/files/${zipFiles[0].id}`,
      range: true,
    },
    { method: 'post', path: '/api/esign/history/export', body: excelBody() },
    {
      method: 'get',
      path: `/api/esign/history/export/${excel.publicId}/document`,
    },
    {
      method: 'post',
      path: `/api/esign/history/export/${pdf.publicId}/downloads`,
    },
    {
      method: 'post',
      path: `${documentPath()}/signers/${signers[0].publicId}/completed-file/downloads`,
    },
  ];
  const listRoutes = (): Route[] => [
    { method: 'get', path: listPath() },
    ...['excel', 'pdf', 'zip'].map(
      (type): Route => ({ method: 'get', path: historyPath(type) }),
    ),
  ];

  async function rejectRoutes(routes: Route[], cookie: string, status: number) {
    for (const route of routes) {
      const call = request(ctx.server)
        [route.method](route.path)
        .set('Cookie', cookie)
        .set('Origin', origin);
      if (route.body) call.send(route.body);
      if (route.range)
        call.set('Range', 'bytes=0-3').set('If-Range', '"synthetic-etag"');
      const response = await call;
      const expectedStatus =
        status === 409 && route.path.includes('/downloads') ? 404 : status;
      expect({ route: route.path, status: response.status }).toEqual({
        route: route.path,
        status: expectedStatus,
      });
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.headers['content-disposition']).toBeUndefined();
      expect(response.headers['content-range']).toBeUndefined();
      expect(response.headers.etag).toBeUndefined();
      for (const secret of [
        documents[0].title,
        'export-private017@example.test',
        '不得揭露的匯出管理備註',
        zipFiles[0].objectKey,
      ])
        expect(response.text).not.toContain(secret);
      if (expectedStatus === 409)
        expect(apiError(response).code).toBe('ESIGN_DEPARTMENT_UNAVAILABLE');
      if (expectedStatus === 404)
        expect(apiError(response).code).toBe('ESIGN_RESOURCE_NOT_FOUND');
    }
  }

  async function assertEmptyLists(cookie: string) {
    const listed = await request(ctx.server)
      .get(listPath())
      .set('Cookie', cookie)
      .expect(200);
    expect(apiData<{ items: unknown[] }>(listed).items).toEqual([]);
    for (const type of ['excel', 'pdf', 'zip']) {
      const response = await request(ctx.server)
        .get(historyPath(type))
        .set('Cookie', cookie)
        .expect(200);
      expect(apiData(response)).toMatchObject({
        items: [],
        total: 0,
        typeTotals: { excel: 0, pdf: 0, zip: 0 },
      });
    }
  }

  async function withoutSideEffects(run: () => Promise<void>) {
    const { manager } = fixture;
    const ids = documents.map((document) => document.id);
    const snapshot = async () => ({
      documents: await manager.find(EsignDocument, {
        where: { id: In(ids) },
        withDeleted: true,
        order: { id: 'ASC' },
      }),
      signers: await manager.find(EsignSigner, {
        where: { documentId: In(ids) },
        order: { id: 'ASC' },
      }),
      jobs: await manager.find(EsignExportJob, {
        where: { documentId: In(ids) },
        order: { id: 'ASC' },
      }),
      files: await manager.find(EsignFileObject, {
        where: { exportJobId: In(zipJobs.map((job) => job.id)) },
        order: { id: 'ASC' },
      }),
    });
    const before = await snapshot();
    const queue = ctx.app.get<Queue>(getQueueToken(ESIGN_EXPORT_QUEUE));
    const queuedBefore = await queue.getJobCounts();
    const enqueue = jest.spyOn(queue, 'add');
    const storage = ctx.app.get<PrivateFileStorage>(PRIVATE_FILE_STORAGE);
    const read = jest.spyOn(storage, 'openReadStream');
    const stat = storage.stat ? jest.spyOn(storage, 'stat') : undefined;
    try {
      await run();
      expect(await snapshot()).toEqual(before);
      expect(await queue.getJobCounts()).toEqual(queuedBefore);
      expect(enqueue).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      if (stat) expect(stat).not.toHaveBeenCalled();
    } finally {
      enqueue.mockRestore();
      read.mockRestore();
      stat?.mockRestore();
    }
  }

  it('合成工作與紀錄可由同部門讀取，外部匯出人依文件部門歸屬', async () => {
    const cookie = fixture.cookies.a2;
    const listed = await request(ctx.server)
      .get(listPath())
      .set('Cookie', cookie)
      .expect(200);
    expect(
      apiData<{ items: { documentId: string }[] }>(listed).items.map(
        (item) => item.documentId,
      ),
    ).toEqual([String(documents[0].id)]);
    await request(ctx.server).get(zipPath()).set('Cookie', cookie).expect(200);
    const preview = await request(ctx.server)
      .get(`${documentPath()}?view=export`)
      .set('Cookie', cookie)
      .expect(200);
    expect(
      apiData<{ signers: { email: string }[] }>(preview).signers[0].email,
    ).toBe('export-private017@example.test');
    expect(preview.text).not.toContain('不得揭露的匯出管理備註');
    for (const type of ['excel', 'pdf', 'zip']) {
      const response = await request(ctx.server)
        .get(historyPath(type))
        .set('Cookie', cookie)
        .expect(200);
      expect(apiData(response)).toMatchObject({
        total: 1,
        typeTotals: { excel: 1, pdf: 1, zip: 1 },
      });
    }
  });

  it('跨部門所有一般匯出直接網址拒絕，列表與筆數不可外洩且無副作用', async () => {
    await withoutSideEffects(async () => {
      for (const cookie of [fixture.cookies.b1, fixture.cookies.sameName]) {
        await rejectRoutes(directRoutes(), cookie, 404);
        await assertEmptyLists(cookie);
      }
    });
  });

  it('缺部門409、失效cookie401涵蓋列表與所有直接網址，先拒絕再查檔', async () => {
    await withoutSideEffects(async () => {
      const routes = [...listRoutes(), ...directRoutes()];
      await rejectRoutes(routes, fixture.cookies.missing, 409);
      await rejectRoutes(
        routes,
        'FT_ESIGN_SESSION=invalid-synthetic-cookie',
        401,
      );
    });
  });

  it('原建立人調職後舊session與舊下載網址失效，不能沿用建立人或原匯出人例外', async () => {
    const { manager, users, cookies } = fixture;
    await manager.update(User, users.a1.id, { departmentCode: 'B001' });
    try {
      await withoutSideEffects(async () => {
        await rejectRoutes(directRoutes(), cookies.a1, 404);
        await assertEmptyLists(cookies.a1);
      });
    } finally {
      await manager.update(User, users.a1.id, { departmentCode: 'A001' });
    }
  });

  it('軟刪除文件不能沿用歷史／工作／檔案網址，列表與計數同步歸零', async () => {
    await fixture.manager.softDelete(EsignDocument, documents[0].id);
    try {
      await withoutSideEffects(async () => {
        await rejectRoutes(directRoutes(), fixture.cookies.a2, 404);
        await assertEmptyLists(fixture.cookies.a2);
      });
    } finally {
      await fixture.manager.restore(EsignDocument, documents[0].id);
    }
  });

  it('同部門有效ID錯置仍拒絕document/job/file、紀錄類型及document/signer關係', async () => {
    await withoutSideEffects(async () => {
      await rejectRoutes(
        [
          { method: 'get', path: zipPath(1, 0) },
          { method: 'post', path: `${zipPath(1, 0)}/retries` },
          {
            method: 'get',
            path: `${zipPath(1, 0)}/files/${zipFiles[0].id}`,
            range: true,
          },
          {
            method: 'get',
            path: `${zipPath()}/files/${zipFiles[1].id}`,
            range: true,
          },
          {
            method: 'get',
            path: `/api/esign/history/export/${pdf.publicId}/document`,
          },
          {
            method: 'post',
            path: `/api/esign/history/export/${excel.publicId}/downloads`,
          },
          {
            method: 'post',
            path: `${documentPath()}/signers/${signers[1].publicId}/completed-file/downloads`,
          },
        ],
        fixture.cookies.a2,
        404,
      );
    });
    // DB 外鍵各自有效，但紀錄的 signer 與 document 不一致，仍須在下載前拒絕。
    await fixture.manager.update(EsignExportJob, pdf.id, {
      signerId: signers[1].id,
    });
    try {
      await withoutSideEffects(() =>
        rejectRoutes(
          [
            {
              method: 'post',
              path: `/api/esign/history/export/${pdf.publicId}/downloads`,
            },
          ],
          fixture.cookies.a2,
          404,
        ),
      );
    } finally {
      await fixture.manager.update(EsignExportJob, pdf.id, {
        signerId: signers[0].id,
      });
    }
  });
});
