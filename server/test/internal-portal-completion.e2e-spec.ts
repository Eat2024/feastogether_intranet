import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Job, Queue } from 'bullmq';
import { WorkerModule } from '#app/worker.module';
import { DocumentFinalizationProcessor } from '#app/worker/esign/document-finalization.processor';
import {
  ESIGN_DOCUMENT_FINALIZATION_QUEUE,
  ESIGN_EXTERNAL_INVITATION_QUEUE,
  ESIGN_MAINTENANCE_QUEUE,
} from '#app/features/esign/esign-queue.constants';
import { HttpService } from '@nestjs/axios';
import { randomBytes, randomUUID } from 'node:crypto';
import { of } from 'rxjs';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { AuthService } from '#app/features/auth/services/auth.service';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import { User } from '#app/features/users/entities/user.entity';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { SignerRepository } from '#app/features/esign/repositories/signer.repository';
import { EsignSigner } from '#app/features/esign/entities/esign-signer.entity';
import { EsignDocument } from '#app/features/esign/entities/esign-document.entity';
import { EsignSignatureRecord } from '#app/features/esign/entities/esign-signature-record.entity';
import { EsignAuditEvent } from '#app/features/esign/entities/esign-audit-event.entity';
import { EsignFileObject } from '#app/features/esign/entities/esign-file-object.entity';
import { apiData } from './api-response.helper';
import { esignTestPng } from './esign-test-png';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

describe('Spec016 員工拒簽與本人副本', () => {
  let ctx: SecurityE2eContext;
  let worker: INestApplicationContext;
  const queues: Queue[] = [];
  let users: User[];
  let cookies: string[];
  const origin = 'http://localhost:3000';
  const http = {
    get: jest.fn(),
    post: (_url: string, body: { person_empids: string[] }) =>
      of({
        data: {
          success: true,
          data: body.person_empids.map((person_empid) => ({
            person_empid,
            email: 'shared@example.test',
          })),
        },
      }),
  };
  beforeAll(async () => {
    ctx = await createSecurityE2eApp((builder) =>
      builder.overrideProvider(HttpService).useValue(http),
    );
    for (const name of [
      ESIGN_DOCUMENT_FINALIZATION_QUEUE,
      ESIGN_EXTERNAL_INVITATION_QUEUE,
      ESIGN_MAINTENANCE_QUEUE,
    ]) {
      const queue = ctx.app.get<Queue>(getQueueToken(name));
      await queue.pause();
      queues.push(queue);
    }
    worker = await NestFactory.createApplicationContext(WorkerModule, {
      logger: false,
    });
    const manager = ctx.app.get(MysqlService).getManager();
    const prefix = randomBytes(5).toString('hex');
    users = await manager.save(
      User,
      [0, 1, 2].map((index) =>
        manager.create(User, {
          empid: `S${prefix}${index}`,
          name: `合成人員${index}`,
          isActive: true,
        }),
      ),
    );
    cookies = await Promise.all(
      users.map(
        async (user) =>
          `${AUTH_COOKIE_NAME}=${(await ctx.app.get(AuthService).issueSession(user.id)).token}`,
      ),
    );
  });
  afterAll(async () => {
    if (worker) await worker.close();
    for (const queue of queues) await queue.resume();
    if (ctx) await closeSecurityE2eApp(ctx);
  });
  async function fixture() {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const created = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', cookies[0])
        .set('Origin', origin)
        .field('title', '合成內部驗證文件')
        .attach('file', Buffer.from(await pdf.save()), {
          filename: 'test.pdf',
          contentType: 'application/pdf',
        })
        .expect(201),
    );
    const document = apiData<{
      id: string;
      signers: Array<{ publicId: string }>;
      fields: Array<{ id: string }>;
    }>(
      await request(ctx.server)
        .post(`/api/esign/documents/${created.id}/initiations`)
        .set('Cookie', cookies[0])
        .set('Origin', origin)
        .send({
          signers: users
            .slice(0, 2)
            .map((user) => ({ type: 'user', userId: String(user.id) })),
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
          allowReject: true,
        })
        .expect(201),
    );
    const signers = await Promise.all(
      document.signers.map((signer) =>
        ctx.app
          .get(SignerRepository)
          .findByPublicId(
            signer.publicId,
            ctx.app.get(MysqlService).getManager(),
          ),
      ),
    );
    return { document, signers };
  }
  const manager = () => ctx.app.get(MysqlService).getManager();
  const path = (id: string) => `/api/esign/signing-tasks/${id}`;
  const post = (url: string, body: object = {}, cookie = cookies[0]) =>
    request(ctx.server)
      .post(url)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send(body);
  async function bodyFor(publicId: string) {
    const task = apiData<{
      consent: { version: string };
      fields: Array<{ id: string }>;
    }>(await post(path(publicId)).expect(201));
    return {
      requestId: randomUUID(),
      consentVersion: task.consent.version,
      accepted: true,
      signatures: task.fields.map((f) => ({
        fieldId: f.id,
        pngDataUrl: `data:image/png;base64,${esignTestPng(10).toString('base64')}`,
      })),
    };
  }
  it('本人拒簽併發重送只寫一次事件；跨人與不一致重送被拒絕', async () => {
    const f = await fixture();
    const id = f.signers[0]!.publicId;
    const body = { requestId: randomUUID(), reason: '  不同意  ' };
    await post(path(id) + '/rejection', body, cookies[2]).expect(404);
    await request(ctx.server)
      .post(path(id) + '/rejection')
      .set('Origin', origin)
      .send(body)
      .expect(401);
    await post(path(id) + '/rejection', { ...body, reason: null }).expect(400);
    await post(path(id) + '/rejection', {
      ...body,
      reason: '字'.repeat(201),
    }).expect(400);
    const responses = await Promise.all([
      post(path(id) + '/rejection', body),
      post(path(id) + '/rejection', body),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(apiData<{ reason: string }>(responses[0]).reason).toBe('不同意');
    expect(
      await manager().count(EsignAuditEvent, {
        where: { signerId: f.signers[0]!.id, eventType: 'signer.rejected' },
      }),
    ).toBe(1);
    await manager().update(EsignDocument, Number(f.document.id), {
      status: 'stopped',
    });
    await post(path(id) + '/rejection', body).expect(200);
    await post(path(id) + '/rejection', {
      ...body,
      requestId: randomUUID(),
    }).expect(409);
    await post(path(id) + '/rejection', { ...body, reason: '改原因' }).expect(
      409,
    );
    await request(ctx.server)
      .get(path(id) + '/source-file')
      .set('Cookie', cookies[0])
      .expect(409);
    await request(ctx.server)
      .get(path(id) + '/completed-file')
      .set('Cookie', cookies[0])
      .expect(409);
    const tasks = apiData<
      Array<{ signerPublicId: string; signer: { status: string } }>
    >(
      await request(ctx.server)
        .get('/api/esign/signing-tasks')
        .set('Cookie', cookies[0])
        .expect(200),
    );
    expect(tasks.find((t) => t.signerPublicId === id)?.signer.status).toBe(
      'rejected',
    );
  });
  it.each(['disabled', 'expired', 'future', 'stopped'])(
    '%s 文件不能新拒簽',
    async (state) => {
      const f = await fixture();
      const id = f.signers[0]!.publicId;
      const changes =
        state === 'disabled'
          ? { allowReject: false }
          : state === 'expired'
            ? {
                signStartAt: new Date(Date.now() - 86400000),
                signEndAt: new Date(Date.now() - 1000),
              }
            : state === 'future'
              ? {
                  signStartAt: new Date(Date.now() + 3600000),
                  signEndAt: new Date(Date.now() + 86400000),
                }
              : { status: 'stopped' };
      await manager().update(EsignDocument, Number(f.document.id), changes);
      await post(path(id) + '/rejection', { requestId: randomUUID() }).expect(
        409,
      );
      expect(
        await manager().count(EsignAuditEvent, {
          where: { signerId: f.signers[0]!.id, eventType: 'signer.rejected' },
        }),
      ).toBe(0);
    },
  );
  it('真實 worker 產製本人副本；到期仍下載相同 PDF，跨人及損毀 fail closed', async () => {
    const f = await fixture();
    const id = f.signers[0]!.publicId;
    const get = (cookie = cookies[0]) =>
      request(ctx.server)
        .get(path(id) + '/completed-file')
        .set('Cookie', cookie);
    await get().expect(409);
    const signed = apiData<{ verificationUrl: string }>(
      await post(path(id) + '/signatures', await bodyFor(id)).expect(201),
    );
    await get().expect(409);
    await worker.get(DocumentFinalizationProcessor).process({
      data: { documentId: Number(f.document.id), signerId: f.signers[0]!.id },
    } as Job<{ documentId: number; signerId: number }>);
    const pdf = await get().expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('attachment');
    expect(pdf.headers['cache-control']).toBe('private, no-store');
    expect(
      (await PDFDocument.load(pdf.body as Uint8Array)).getPageCount(),
    ).toBeGreaterThan(0);
    const code = new URL(signed.verificationUrl).pathname.split('/').at(-1);
    const verified = apiData<{ signature: { authenticationMethod: string } }>(
      await request(ctx.server)
        .get('/api/signature-verifications/' + code)
        .expect(200),
    );
    expect(verified.signature.authenticationMethod).toBe('internal_session');
    const tasks = apiData<
      Array<{
        signerPublicId: string;
        signer: { completion: { status: string } };
      }>
    >(
      await request(ctx.server)
        .get('/api/esign/signing-tasks')
        .set('Cookie', cookies[0])
        .expect(200),
    );
    expect(
      tasks.find((t) => t.signerPublicId === id)?.signer.completion.status,
    ).toBe('ready');
    await get(cookies[1]).expect(404);
    await request(ctx.server)
      .get(path(id) + '/completed-file')
      .expect(401);
    await request(ctx.server)
      .get(path(f.signers[1]!.publicId) + '/completed-file')
      .set('Cookie', cookies[1])
      .expect(409);
    await manager().update(EsignDocument, Number(f.document.id), {
      status: 'expired',
      signStartAt: new Date(Date.now() - 86400000),
      signEndAt: new Date(Date.now() - 1000),
    });
    expect((await get().expect(200)).body).toEqual(pdf.body);
    const completedSigner = await manager().findOneByOrFail(EsignSigner, {
      id: f.signers[0]!.id,
    });
    await manager().update(EsignSigner, f.signers[0]!.id, {
      completionReadyAt: null,
      completionStatus: 'failed',
    });
    await get().expect(409);
    await manager().update(EsignSigner, f.signers[0]!.id, {
      completionStatus: 'ready',
      completionReadyAt: completedSigner.completionReadyAt,
    });
    const record = await manager().findOneByOrFail(EsignSignatureRecord, {
      signerId: f.signers[0]!.id,
    });
    const file = await manager().findOneByOrFail(EsignFileObject, {
      signatureRecordId: record.id,
      filePurpose: 'completed_pdf',
    });
    await manager().update(EsignFileObject, file.id, {
      sha256: '0'.repeat(64),
    });
    await get().expect(409);
  });
});
