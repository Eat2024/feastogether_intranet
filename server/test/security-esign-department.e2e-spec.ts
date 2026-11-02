import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { In } from 'typeorm';
import { User } from '#app/features/users/entities/user.entity';
import { AuthSession } from '#app/features/auth/entities/auth-session.entity';
import { EsignDocument } from '#app/features/esign/entities/esign-document.entity';
import { EsignSigner } from '#app/features/esign/entities/esign-signer.entity';
import { EsignAuditEvent } from '#app/features/esign/entities/esign-audit-event.entity';
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
    fixture = await createDepartmentFixtures(ctx);
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
        await manager.delete(EsignAuditEvent, { documentId: document.id });
        await manager.delete(EsignSigner, { documentId: document.id });
        await manager.delete(EsignDocument, { id: document.id });
      }
      const ids = Object.values(fixture.users).map((user) => user.id);
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
      for (const suffix of ['', '/history', '/source-file']) {
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
    const auditsBefore = await manager.count(EsignAuditEvent, {
      where: { documentId: document.id },
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
      await manager.count(EsignAuditEvent, {
        where: { documentId: document.id },
      }),
    ).toBe(auditsBefore);
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
