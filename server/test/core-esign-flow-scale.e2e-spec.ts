import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { getQueueToken } from '@nestjs/bullmq';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { User } from '#app/features/users/entities/user.entity';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { readPrivateFile } from '#app/infrastructure/file-storage/read-private-file';
import { FeastogetherHrService } from '#app/infrastructure/http-client/feastogether/services/feastogether-hr.service';
import { EsignSigningService } from '#app/features/esign/services/esign-signing.service';
import { EsignConsentService } from '#app/features/esign/services/esign-consent.service';
import { DocumentFinalizationProcessor } from '#app/worker/esign/document-finalization.processor';
import { ESIGN_DOCUMENT_FINALIZATION_QUEUE } from '#app/features/esign/esign-queue.constants';
import { WorkerModule } from '#app/worker.module';
import { apiData } from './api-response.helper';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';
import { esignTestPng } from './esign-test-png';

/** 全流程規模驗收：固定樣本數不是產品上限，僅在 fail-closed 測試 DB 執行。 */
describe('全公司 6,000 人個人副本', () => {
  let ctx: SecurityE2eContext;
  let db: DataSource;
  let storage: PrivateFileStorage;
  let worker: INestApplicationContext | undefined;
  let queue: Queue;
  let cookie: string;
  const documents: number[] = [];
  const prefix = 'CRS' + randomUUID().slice(0, 8);
  let users: Array<{ id: number; empid: string }> = [];

  beforeAll(async () => {
    ctx = await createSecurityE2eApp((builder) =>
      builder.overrideProvider(FeastogetherHrService).useValue({
        lookupEligibleStaff: jest.fn(async (empid: string) => ({
          person_empid: empid,
          person_name: '規模測試員工',
          person_status: 1,
          person_status_name: '正式',
          department_id: 'CRS',
          department_name: '合成測試部',
          title: '測試員工',
        })),
      }),
    );
    db = ctx.app.get<DataSource>(MYSQL_MAIN);
    storage = ctx.app.get<PrivateFileStorage>(PRIVATE_FILE_STORAGE);
    queue = ctx.app.get<Queue>(
      getQueueToken(ESIGN_DOCUMENT_FINALIZATION_QUEUE),
    );
    for (let offset = 0; offset < 6001; offset += 500) {
      await db
        .createQueryBuilder()
        .insert()
        .into(User)
        .values(
          Array.from({ length: Math.min(500, 6001 - offset) }, (_, i) => ({
            empid: prefix + String(offset + i).padStart(5, '0'),
            name: '合成員工' + (offset + i),
            isActive: true,
            departmentName: '合成測試部',
          })),
        )
        .execute();
    }
    users = await db.query<Array<{ id: number; empid: string }>>(
      'SELECT id, empid FROM users WHERE empid LIKE ? ORDER BY empid',
      [prefix + '%'],
    );
    expect(users).toHaveLength(6001);
    const launch = apiData<{ launchUrl: string }>(
      await request(ctx.server)
        .post('/api/auth/webview-launches')
        .set('Authorization', 'Bearer ' + createLaunchJwt(users[0].empid))
        .expect(201),
    );
    const session = await request(ctx.server)
      .post('/api/auth/session')
      .type('form')
      .send({ code: new URL(launch.launchUrl).searchParams.get('code') })
      .expect(303);
    const cookies: unknown = session.headers['set-cookie'];
    cookie = String(Array.isArray(cookies) ? cookies[0] : cookies);
    await queue.pause();
    worker = await NestFactory.createApplicationContext(WorkerModule, {
      logger: false,
    });
  }, 120_000);

  afterAll(async () => {
    await worker?.close();
    if (queue) {
      const jobs = await queue.getJobs([
        'waiting',
        'delayed',
        'failed',
        'completed',
      ]);
      for (const job of jobs)
        if (documents.includes(Number(job.data.documentId))) await job.remove();
      await queue.resume();
    }
    for (const documentId of documents) {
      const files = await db.query<
        Array<{ object_key: string; object_version: string | null }>
      >(
        'SELECT f.object_key, f.object_version FROM esign_file_objects f LEFT JOIN esign_signature_records r ON r.id=f.signature_record_id LEFT JOIN esign_signers s ON s.id=r.signer_id WHERE f.document_id=? OR s.document_id=?',
        [documentId, documentId],
      );
      await db.query('DELETE FROM esign_audit_events WHERE document_id=?', [
        documentId,
      ]);
      await db.query(
        'DELETE FROM esign_verification_records WHERE document_id=?',
        [documentId],
      );
      await db.query(
        'DELETE f FROM esign_file_objects f LEFT JOIN esign_signature_records r ON r.id=f.signature_record_id LEFT JOIN esign_signers s ON s.id=r.signer_id WHERE f.document_id=? OR s.document_id=?',
        [documentId, documentId],
      );
      await db.query(
        'DELETE FROM esign_signature_records WHERE signer_id IN (SELECT id FROM esign_signers WHERE document_id=?)',
        [documentId],
      );
      await db.query('DELETE FROM esign_document_fields WHERE document_id=?', [
        documentId,
      ]);
      await db.query('DELETE FROM esign_signers WHERE document_id=?', [
        documentId,
      ]);
      await db.query('DELETE FROM esign_documents WHERE id=?', [documentId]);
      for (const file of files)
        await storage.delete({
          objectKey: file.object_key,
          objectVersion: file.object_version ?? undefined,
        });
    }
    if (db) {
      await db.query(
        'DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM users WHERE empid LIKE ?)',
        [prefix + '%'],
      );
      await db.query('DELETE FROM users WHERE empid LIKE ?', [prefix + '%']);
    }
    if (ctx) await closeSecurityE2eApp(ctx);
  }, 120_000);

  it('6,001 人可保存與發起；6,000 人全部成功簽署、各產一份 PDF 並結案', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([595, 842]);
    const source = Buffer.from(await pdf.save());
    const fields = ['signature', 'date', 'signature'].map((type, i) => ({
      type,
      page: 1,
      xPercent: 10,
      yPercent: 10 + i * 20,
      widthPercent: 25,
      heightPercent: 10,
      sortOrder: i,
    }));
    const create = async () => {
      const response = await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', cookie)
        .set('Origin', 'http://localhost:3000')
        .field('title', '全公司規模驗收')
        .field('fields', JSON.stringify(fields))
        .attach('file', source, {
          filename: 'scale.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);
      const id = Number(apiData<{ id: string }>(response).id);
      documents.push(id);
      return id;
    };
    const input = (count: number) => ({
      signers: users
        .slice(0, count)
        .map((user) => ({ type: 'user', userId: String(user.id) })),
      fields,
      signStartAt: new Date(Date.now() - 60_000).toISOString(),
      signEndAt: new Date(Date.now() + 86_400_000).toISOString(),
      watermark: false,
      allowReject: false,
    });
    const metrics: Record<string, number> = {
      requestBytes6001: Buffer.byteLength(JSON.stringify(input(6001))),
    };
    const id6001 = await create();
    await request(ctx.server)
      .put('/api/esign/documents/' + id6001 + '/draftSave')
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ signers: input(6001).signers })
      .expect(200);
    const start6001 = performance.now();
    await request(ctx.server)
      .post('/api/esign/documents/' + id6001 + '/initiations')
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send(input(6001))
      .expect(201);
    metrics.initiation6001Ms = performance.now() - start6001;
    const [count6001] = await db.query<Array<{ total: number }>>(
      'SELECT COUNT(*) total FROM esign_signers WHERE document_id=?',
      [id6001],
    );
    expect(Number(count6001.total)).toBe(6001);
    const candidates = apiData<Array<{ employeeNo: string }>>(
      await request(ctx.server)
        .get('/api/esign/signer-candidates')
        .query({ q: prefix })
        .set('Cookie', cookie)
        .expect(200),
    );
    expect(candidates).toHaveLength(6001);
    const documentId = await create();
    const initiationStart = performance.now();
    await request(ctx.server)
      .post('/api/esign/documents/' + documentId + '/initiations')
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send(input(6000))
      .expect(201);
    metrics.initiation6000Ms = performance.now() - initiationStart;
    const signers = await db.query<
      Array<{ id: number; public_id: string; user_id: number }>
    >(
      'SELECT id, public_id, user_id FROM esign_signers WHERE document_id=? ORDER BY sort_order',
      [documentId],
    );
    const savedFields = await db.query<
      Array<{ id: number; field_type: string }>
    >(
      'SELECT id, field_type FROM esign_document_fields WHERE document_id=? ORDER BY sort_order',
      [documentId],
    );
    expect(signers).toHaveLength(6000);
    expect(savedFields).toHaveLength(3);
    const signing = ctx.app.get(EsignSigningService);
    const consent = ctx.app.get(EsignConsentService).getActive();
    const processor = worker!.get(DocumentFinalizationProcessor);
    metrics.peakRssBytes = process.memoryUsage().rss;
    const signingStart = performance.now();
    const [lockBefore] = await db.query<Array<{ Value: string }>>(
      "SHOW GLOBAL STATUS LIKE 'Innodb_row_lock_time'",
    );
    for (let i = 0; i < signers.length; i += 1) {
      const signer = signers[i];
      await signing.sign(
        signer.public_id,
        { kind: 'internal', userId: Number(signer.user_id) },
        {
          requestId: randomUUID(),
          consentVersion: consent.version,
          accepted: true,
          signatures: savedFields
            .filter((field) => field.field_type === 'signature')
            .map((field) => ({
              fieldId: String(field.id),
              pngDataUrl:
                'data:image/png;base64,' +
                esignTestPng(i + 1).toString('base64'),
            })),
        },
        {},
      );
      metrics.peakRssBytes = Math.max(
        metrics.peakRssBytes,
        process.memoryUsage().rss,
      );
      if ((i + 1) % 1000 === 0) console.info('CR_SCALE_SIGNED', i + 1);
    }
    metrics.signing6000Ms = performance.now() - signingStart;
    metrics.queueBacklog = (await queue.getJobs(['waiting', 'delayed'])).filter(
      (job) => Number(job.data.documentId) === documentId,
    ).length;
    expect(metrics.queueBacklog).toBe(6000);
    const renderingStart = performance.now();
    for (let i = 0; i < signers.length; i += 1) {
      await processor.process({
        data: { documentId, signerId: Number(signers[i].id) },
      } as Job<{ documentId: number; signerId: number }>);
      metrics.peakRssBytes = Math.max(
        metrics.peakRssBytes,
        process.memoryUsage().rss,
      );
      if ((i + 1) % 1000 === 0) console.info('CR_SCALE_READY', i + 1);
    }
    metrics.rendering6000Ms = performance.now() - renderingStart;
    const [lockAfter] = await db.query<Array<{ Value: string }>>(
      "SHOW GLOBAL STATUS LIKE 'Innodb_row_lock_time'",
    );
    metrics.mysqlGlobalRowLockWaitDeltaMs =
      Number(lockAfter.Value) - Number(lockBefore.Value);
    const [summary] = await db.query<
      Array<{
        status: string;
        ready: number;
        records: number;
        files: number;
        events: number;
        manifestBytes: number;
        storageBytes: number;
      }>
    >(
      "SELECT d.status, (SELECT COUNT(*) FROM esign_signers s WHERE s.document_id=d.id AND s.completion_status='ready') ready, (SELECT COUNT(*) FROM esign_signature_records r JOIN esign_signers s ON s.id=r.signer_id WHERE s.document_id=d.id) records, (SELECT COUNT(*) FROM esign_file_objects f JOIN esign_signature_records r ON r.id=f.signature_record_id JOIN esign_signers s ON s.id=r.signer_id WHERE s.document_id=d.id AND f.file_purpose='completed_pdf') files, (SELECT COUNT(*) FROM esign_audit_events a WHERE a.document_id=d.id AND a.event_type='document.completed') events, (SELECT OCTET_LENGTH(v.manifest_json) FROM esign_verification_records v WHERE v.document_id=d.id) manifestBytes, (SELECT SUM(f.file_size) FROM esign_file_objects f JOIN esign_signature_records r ON r.id=f.signature_record_id JOIN esign_signers s ON s.id=r.signer_id WHERE s.document_id=d.id AND f.file_purpose='completed_pdf') storageBytes FROM esign_documents d WHERE d.id=?",
      [documentId],
    );
    expect(summary).toMatchObject({
      status: 'completed',
      ready: 6000,
      records: 6000,
      files: 6000,
      events: 1,
    });
    const completed = await db.query<
      Array<{
        object_key: string;
        object_version: string | null;
        sha256: string;
        owner: number;
        signer_id: number;
        document_id: number | null;
      }>
    >(
      "SELECT f.object_key, f.object_version, f.sha256, f.document_id, r.signer_id, s.id owner FROM esign_file_objects f JOIN esign_signature_records r ON r.id=f.signature_record_id JOIN esign_signers s ON s.id=r.signer_id WHERE s.document_id=? AND f.file_purpose='completed_pdf'",
      [documentId],
    );
    expect(new Set(completed.map((file) => file.sha256)).size).toBe(6000);
    for (const file of completed) {
      expect(file.document_id).toBeNull();
      expect(Number(file.signer_id)).toBe(Number(file.owner));
      const bytes = await readPrivateFile(storage, {
        objectKey: file.object_key,
        objectVersion: file.object_version ?? undefined,
      });
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        file.sha256,
      );
      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    }
    metrics.manifestBytes = Number(summary.manifestBytes);
    metrics.completedPdfBytes = Number(summary.storageBytes);
    process.stdout.write('CR_SCALE_METRICS ' + JSON.stringify(metrics) + '\n');
  }, 1_800_000);
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
