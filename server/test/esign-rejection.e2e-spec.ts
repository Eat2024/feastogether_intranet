import { DocumentRepository } from '#app/features/esign/repositories/document.repository';
import { getQueueToken } from '@nestjs/bullmq';
import { ESIGN_DOCUMENT_FINALIZATION_QUEUE } from '#app/features/esign/esign-queue.constants';
import { EsignMaintenanceProcessor } from '#app/worker/esign/esign-maintenance.processor';
import type { Queue } from 'bullmq';
import { RejectionCompletion1792454401000 } from '#app/infrastructure/database/migrations/1792454401000-RejectionCompletion';
import { esignTestPng } from './esign-test-png';
import type { Job } from 'bullmq';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import { DataSource, type EntityManager } from 'typeorm';
import { NestFactory } from '@nestjs/core';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { FeastogetherHrService } from '#app/infrastructure/http-client/feastogether/services/feastogether-hr.service';
import { WorkerModule } from '#app/worker.module';
import { DocumentFinalizationProcessor } from '#app/worker/esign/document-finalization.processor';
import { EsignTokenService } from '#app/features/esign/services/esign-token.service';
import { apiData } from './api-response.helper';
import {
  closeSecurityE2eApp,
  createSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';
import {
  openExternalSession,
  openInternalEmailSession,
} from './external-session.helper';

function launchJwt(empid: string) {
  const encode = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const prefix = `${encode({ alg: 'RS256', typ: 'FT-ESIGN-LAUNCH+JWT' })}.${encode({ iss: 'e2e-main-platform', aud: 'e2e-esign', sub: empid, jti: randomUUID(), iat: now, nbf: now, exp: now + 120 })}`;
  return `${prefix}.${sign('RSA-SHA256', Buffer.from(prefix), createPrivateKey(Buffer.from(process.env.WEBVIEW_TEST_PRIVATE_KEY_B64!, 'base64').toString())).toString('base64url')}`;
}
interface Detail {
  id: string;
  status: string;
  signers: {
    publicId: string;
    status: string;
    rejectedAt: string | null;
    rejectReason: string | null;
  }[];
}
describe('拒簽 HTTP 與結案', () => {
  let ctx: SecurityE2eContext;
  let db: DataSource;
  let cookie: string;
  let userId: string;
  const documentIds: string[] = [];
  beforeAll(async () => {
    ctx = await createSecurityE2eApp((builder) =>
      builder.overrideProvider(FeastogetherHrService).useValue({
        getStaffEmails: syntheticStaffEmails,
        lookupEligibleStaff: async (empid: string) => ({
          person_empid: empid,
          person_name: '拒簽測試',
          person_status: 1,
          person_status_name: '正式',
          department_id: 'D009',
          department_name: '測試部',
          title: '測試員工',
        }),
      }),
    );
    db = ctx.app.get(MYSQL_MAIN);
    const launch = await request(ctx.server)
      .post('/api/auth/webview-launches')
      .set('Authorization', `Bearer ${launchJwt('E2E00903')}`)
      .expect(201);
    const code = new URL(
      apiData<{ launchUrl: string }>(launch).launchUrl,
    ).searchParams.get('code');
    const session = await request(ctx.server)
      .post('/api/auth/session')
      .type('form')
      .send({ code })
      .expect(303);
    cookie = String(session.headers['set-cookie'][0]);
    const rows = await db.query<Array<{ id: string }>>(
      "SELECT id FROM users WHERE empid = 'E2E00903'",
    );
    userId = String(rows[0].id);
  });
  afterAll(async () => {
    if (db)
      for (const id of documentIds) {
        const files = await db.query<
          Array<{ object_key: string; object_version?: string }>
        >(
          'SELECT f.object_key,f.object_version FROM esign_file_objects f LEFT JOIN esign_signature_records r ON r.id=f.signature_record_id LEFT JOIN esign_signers s ON s.id=r.signer_id WHERE f.document_id=? OR s.document_id=?',
          [id, id],
        );
        await db.query('DELETE FROM esign_audit_events WHERE document_id=?', [
          id,
        ]);
        await db.query(
          'DELETE FROM esign_verification_records WHERE document_id=?',
          [id],
        );
        await db.query(
          'DELETE FROM esign_notification_logs WHERE batch_id IN (SELECT id FROM esign_notification_batches WHERE document_id=?)',
          [id],
        );
        await db.query(
          'DELETE FROM esign_notification_batches WHERE document_id=?',
          [id],
        );
        await db.query(
          'DELETE f FROM esign_file_objects f LEFT JOIN esign_signature_records r ON r.id=f.signature_record_id LEFT JOIN esign_signers s ON s.id=r.signer_id WHERE f.document_id=? OR s.document_id=?',
          [id, id],
        );
        await db.query(
          'DELETE FROM esign_signature_records WHERE signer_id IN (SELECT id FROM esign_signers WHERE document_id=?)',
          [id],
        );
        await db.query(
          'DELETE FROM esign_document_fields WHERE document_id=?',
          [id],
        );
        await db.query('DELETE FROM esign_signers WHERE document_id=?', [id]);
        await db.query('DELETE FROM esign_documents WHERE id=?', [id]);
        for (const file of files)
          await ctx.app.get<PrivateFileStorage>(PRIVATE_FILE_STORAGE).delete({
            objectKey: file.object_key,
            objectVersion: file.object_version,
          });
      }
    if (ctx) await closeSecurityE2eApp(ctx);
  });
  const emailCookies = new Map<string, string>();
  async function create(signers: object[], allowReject = true) {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const created = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', cookie)
        .set('Origin', 'http://localhost:3000')
        .field('title', '拒簽測試')
        .attach('file', Buffer.from(await pdf.save()), {
          filename: 'rejection.pdf',
          contentType: 'application/pdf',
        })
        .expect(201),
    );
    documentIds.push(created.id);
    const result = apiData<Detail>(
      await request(ctx.server)
        .post(`/api/esign/documents/${created.id}/initiations`)
        .set('Cookie', cookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          signers,
          fields: [
            {
              type: 'signature',
              page: 1,
              xPercent: 10,
              yPercent: 10,
              widthPercent: 25,
              heightPercent: 10,
              sortOrder: 0,
            },
          ],
          signStartAt: new Date(Date.now() - 60000).toISOString(),
          signEndAt: new Date(Date.now() + 86400000).toISOString(),
          watermark: false,
          allowReject,
        })
        .expect(201),
    );
    for (const signer of result.signers)
      emailCookies.set(
        signer.publicId,
        await openInternalEmailSession(ctx, signer.publicId),
      );
    return result;
  }
  const reject = (id: string, body: object) =>
    request(ctx.server)
      .post('/api/external-signing-task/rejection')
      .set('Cookie', emailCookies.get(id)!)
      .set('Origin', 'http://localhost:3000')
      .send({ ...body, signerPublicId: id });
  it('內部拒簽重送不改證據、本人可讀但不可讀來源，全拒可結案', async () => {
    const doc = await create([{ type: 'user', userId }]);
    const id = doc.signers[0].publicId;
    const body = { requestId: randomUUID(), reason: ' 不同意 ' };
    const queue = ctx.app.get<Queue>(
      getQueueToken(ESIGN_DOCUMENT_FINALIZATION_QUEUE),
    );
    const failure = jest
      .spyOn(queue, 'add')
      .mockRejectedValueOnce(new Error('synthetic queue outage'));
    const result = apiData(await reject(id, body).expect(201));
    failure.mockRestore();
    expect(apiData(await reject(id, body).expect(200))).toEqual(result);
    await reject(id, { ...body, reason: '改寫' }).expect(409);
    const tasks = apiData<
      Array<{ signer: { status: string; rejectReason: string } }>
    >(
      await request(ctx.server)
        .get('/api/esign/signing-tasks')
        .set('Cookie', cookie)
        .expect(200),
    );
    expect(
      tasks.some(
        (t) =>
          t.signer.status === 'rejected' && t.signer.rejectReason === '不同意',
      ),
    ).toBe(true);
    await request(ctx.server)
      .get(`/api/esign/signing-tasks/${id}/source-file`)
      .set('Cookie', cookie)
      .expect(403);
    await request(ctx.server)
      .get('/api/external-signing-task/source-file')
      .set('Cookie', emailCookies.get(id)!)
      .expect(401);
    const worker = await NestFactory.createApplicationContext(WorkerModule, {
      logger: false,
    });
    try {
      await worker.get(EsignMaintenanceProcessor).process({} as Job);
    } finally {
      await worker.close();
    }
    const final = apiData<Detail>(
      await request(ctx.server)
        .get(`/api/esign/documents/${doc.id}`)
        .set('Cookie', cookie)
        .expect(200),
    );
    expect(final.status).toBe('completed');
    await request(ctx.server)
      .post(`/api/esign/documents/${doc.id}/exports`)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ type: 'signed_copies_zip' })
      .expect(409);
    const runner = db.createQueryRunner();
    try {
      await expect(
        new RejectionCompletion1792454401000().down(runner),
      ).rejects.toThrow('已有拒簽證據');
    } finally {
      await runner.release();
    }
  });
  it('兩位不同簽署人依序取得文件鎖，最後拒簽看得到前一位已提交的終態', async () => {
    const doc = await create([
      { type: 'email', name: '競態 A', email: 'race-a@example.test' },
      { type: 'email', name: '競態 B', email: 'race-b@example.test' },
    ]);
    const sessions: string[] = [];
    for (const signer of doc.signers) {
      const rows = await db.query<
        Array<{ invitation_token_ciphertext: string }>
      >(
        'SELECT invitation_token_ciphertext FROM esign_signers WHERE public_id=?',
        [signer.publicId],
      );
      sessions.push(
        await openExternalSession(
          ctx,
          ctx.app
            .get(EsignTokenService)
            .decrypt(rows[0].invitation_token_ciphertext),
        ),
      );
    }
    const isolation = await db.query<Array<{ isolation: string }>>(
      'SELECT @@transaction_isolation AS isolation',
    );
    expect(isolation[0].isolation).toBe('REPEATABLE-READ');
    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    };
    const firstLocked = deferred();
    const secondWaiting = deferred();
    const releaseFirst = deferred();
    const repository = ctx.app.get<DocumentRepository>(DocumentRepository);
    const realRepository = new DocumentRepository();
    const original = (id: number, manager: EntityManager) =>
      realRepository.findByIdForUpdate(id, manager);
    let arrivals = 0;
    // 只控制真 MySQL 鎖的到達順序；所有 SQL、交易及 HTTP 結果都使用正式實作。
    const barrier = jest
      .spyOn(repository, 'findByIdForUpdate')
      .mockImplementation(async (id, manager) => {
        if (id !== Number(doc.id)) return original(id, manager);
        const arrival = ++arrivals;
        if (arrival === 2) secondWaiting.resolve();
        const result = await original(id, manager);
        if (arrival === 1) {
          firstLocked.resolve();
          await releaseFirst.promise;
        }
        return result;
      });
    const submit = (index: number) =>
      request(ctx.server)
        .post('/api/external-signing-task/rejection')
        .set('Cookie', sessions[index])
        .set('Origin', 'http://localhost:3000')
        .send({
          signerPublicId: doc.signers[index].publicId,
          requestId: randomUUID(),
        })
        .then((response) => response);
    try {
      const first = submit(0);
      await firstLocked.promise;
      const second = submit(1);
      await secondWaiting.promise;
      releaseFirst.resolve();
      expect(
        (await Promise.all([first, second])).map((result) => result.status),
      ).toEqual([201, 201]);
    } finally {
      releaseFirst.resolve();
      barrier.mockRestore();
    }
    const final = apiData<Detail>(
      await request(ctx.server)
        .get(`/api/esign/documents/${doc.id}`)
        .set('Cookie', cookie)
        .expect(200),
    );
    expect(final.signers.map((signer) => signer.status)).toEqual([
      'rejected',
      'rejected',
    ]);
    expect(final.status).toBe('finalizing');
    const worker = await NestFactory.createApplicationContext(WorkerModule, {
      logger: false,
    });
    try {
      await worker.get(EsignMaintenanceProcessor).process({} as Job);
    } finally {
      await worker.close();
    }
    expect(
      apiData<Detail>(
        await request(ctx.server)
          .get(`/api/esign/documents/${doc.id}`)
          .set('Cookie', cookie)
          .expect(200),
      ).status,
    ).toBe('completed');
  });
  it('外部 OTP 本人可拒簽、重送與讀結果，不可讀來源或副本', async () => {
    const doc = await create([
      { type: 'email', name: '外部測試', email: 'rejection@example.test' },
    ]);
    const id = doc.signers[0].publicId;
    const rows = await db.query<Array<{ invitation_token_ciphertext: string }>>(
      'SELECT invitation_token_ciphertext FROM esign_signers WHERE public_id = ?',
      [id],
    );
    const token = ctx.app
      .get(EsignTokenService)
      .decrypt(rows[0].invitation_token_ciphertext);
    const external = await openExternalSession(ctx, token);
    const body = { signerPublicId: id, requestId: randomUUID(), reason: '' };
    const submit = (data: object) =>
      request(ctx.server)
        .post('/api/external-signing-task/rejection')
        .set('Cookie', external)
        .set('Origin', 'http://localhost:3000')
        .send(data);
    await submit({ ...body, signerPublicId: randomUUID() }).expect(404);
    const result = apiData(await submit(body).expect(201));
    expect(apiData(await submit(body).expect(200))).toEqual(result);
    const task = apiData<{ signer: { status: string } }>(
      await request(ctx.server)
        .get('/api/external-signing-task')
        .set('Cookie', external)
        .expect(200),
    );
    expect(task.signer.status).toBe('rejected');
    await request(ctx.server)
      .get('/api/external-signing-task/source-file')
      .set('Cookie', external)
      .expect(401);
    await request(ctx.server)
      .get('/api/external-signing-task/completed-file')
      .set('Cookie', external)
      .expect(401);
  });
  async function signatureInput(id: string) {
    const task = apiData<{
      consent: { version: string };
      fields: Array<{ id: string; type: string }>;
    }>(
      await request(ctx.server)
        .post('/api/external-signing-task')
        .set('Cookie', emailCookies.get(id)!)
        .set('Origin', 'http://localhost:3000')
        .expect(200),
    );
    return {
      signerPublicId: id,
      requestId: randomUUID(),
      consentVersion: task.consent.version,
      accepted: true,
      signatures: task.fields
        .filter((f) => f.type === 'signature')
        .map((f) => ({
          fieldId: f.id,
          pngDataUrl: `data:image/png;base64,${esignTestPng(3).toString('base64')}`,
        })),
    };
  }
  it('同時簽署與拒簽只有一個終態，不能同時建立簽拒證據', async () => {
    const doc = await create([{ type: 'user', userId }]);
    const id = doc.signers[0].publicId;
    const input = await signatureInput(id);
    const results = await Promise.all([
      reject(id, { requestId: randomUUID() }),
      request(ctx.server)
        .post('/api/external-signing-task/signatures')
        .set('Cookie', emailCookies.get(id)!)
        .set('Origin', 'http://localhost:3000')
        .send(input),
    ]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.some((r) => [401, 409].includes(r.status))).toBe(true);
    const final = apiData<Detail>(
      await request(ctx.server)
        .get(`/api/esign/documents/${doc.id}`)
        .set('Cookie', cookie)
        .expect(200),
    );
    expect(['signed', 'rejected']).toContain(final.signers[0].status);
  });
  it('部分簽署、部分拒簽，只為已簽者產製 PDF 並以 v3 結案驗證', async () => {
    const doc = await create([
      { type: 'user', userId },
      { type: 'email', name: '外部拒簽', email: 'mixed@example.test' },
    ]);
    const id = doc.signers[0].publicId;
    const other = doc.signers[1].publicId;
    const input = await signatureInput(id);
    const signed = apiData<{ verificationUrl: string }>(
      await request(ctx.server)
        .post('/api/external-signing-task/signatures')
        .set('Cookie', emailCookies.get(id)!)
        .set('Origin', 'http://localhost:3000')
        .send(input)
        .expect(201),
    );
    const rows = await db.query<
      Array<{ id: number; invitation_token_ciphertext: string }>
    >(
      'SELECT id,invitation_token_ciphertext FROM esign_signers WHERE public_id=?',
      [other],
    );
    const external = await openExternalSession(
      ctx,
      ctx.app
        .get(EsignTokenService)
        .decrypt(rows[0].invitation_token_ciphertext),
    );
    await request(ctx.server)
      .post('/api/external-signing-task/rejection')
      .set('Cookie', external)
      .set('Origin', 'http://localhost:3000')
      .send({
        signerPublicId: other,
        requestId: randomUUID(),
        reason: '不接受',
      })
      .expect(201);
    const internal = await db.query<Array<{ id: number }>>(
      'SELECT id FROM esign_signers WHERE public_id=?',
      [id],
    );
    const worker = await NestFactory.createApplicationContext(WorkerModule, {
      logger: false,
    });
    try {
      await worker.get(DocumentFinalizationProcessor).process({
        data: { documentId: Number(doc.id), signerId: internal[0].id },
      } as Job);
    } finally {
      await worker.close();
    }
    const final = apiData<Detail>(
      await request(ctx.server)
        .get(`/api/esign/documents/${doc.id}`)
        .set('Cookie', cookie)
        .expect(200),
    );
    expect(final.status).toBe('completed');
    const code = signed.verificationUrl.split('/').at(-1);
    await request(ctx.server)
      .get(`/api/signature-verifications/${code}`)
      .expect(200);
  });
});
import { syntheticStaffEmails } from './synthetic-staff-emails.helper';
