import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { NestFactory } from '@nestjs/core';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import type { Job, Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import {
  ESIGN_DOCUMENT_FINALIZATION_JOB,
  ESIGN_DOCUMENT_FINALIZATION_QUEUE,
  ESIGN_EXTERNAL_INVITATION_JOB,
  ESIGN_EXTERNAL_INVITATION_QUEUE,
  ESIGN_MAINTENANCE_QUEUE,
} from '#app/features/esign/esign-queue.constants';
import { EsignTokenService } from '#app/features/esign/services/esign-token.service';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { FeastogetherHrService } from '#app/infrastructure/http-client/feastogether/services/feastogether-hr.service';
import { WorkerModule } from '#app/worker.module';
import { EsignMaintenanceProcessor } from '#app/worker/esign/esign-maintenance.processor';
import { apiData } from './api-response.helper';
import {
  closeSecurityE2eApp,
  createSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

interface LaunchView {
  launchUrl: string;
}

interface DocumentDetail {
  id: string;
  status: string;
}

interface InvitationJobData {
  notificationLogId: number;
}

describe('核心電子簽真實 queue e2e', () => {
  const creatorEmpid = 'E2E003Q1';
  let ctx: SecurityE2eContext;
  let db: DataSource;
  let storage: PrivateFileStorage;
  let invitationQueue: Queue<InvitationJobData>;
  let finalizationQueue: Queue;
  let maintenanceQueue: Queue;
  let documentId: number | undefined;

  beforeAll(async () => {
    if (process.env.NODE_ENV !== 'test' || process.env.REDIS_DB === '0') {
      throw new Error('queue e2e 只允許使用隔離的 test Redis DB');
    }
    ctx = await createSecurityE2eApp((builder) =>
      builder.overrideProvider(FeastogetherHrService).useValue({
        lookupEligibleStaff: jest.fn((empid: string) =>
          Promise.resolve({
            person_empid: empid,
            person_name: 'Queue 建立人',
            person_status: 1,
            person_status_name: '正式',
            department_id: 'D003Q',
            department_name: 'Queue 測試部',
            title: '測試員工',
          }),
        ),
      }),
    );
    db = ctx.app.get<DataSource>(MYSQL_MAIN);
    storage = ctx.app.get<PrivateFileStorage>(PRIVATE_FILE_STORAGE);
    invitationQueue = ctx.app.get<Queue<InvitationJobData>>(
      getQueueToken(ESIGN_EXTERNAL_INVITATION_QUEUE),
    );
    finalizationQueue = ctx.app.get<Queue>(
      getQueueToken(ESIGN_DOCUMENT_FINALIZATION_QUEUE),
    );
    maintenanceQueue = ctx.app.get<Queue>(
      getQueueToken(ESIGN_MAINTENANCE_QUEUE),
    );
    await Promise.all(
      [invitationQueue, finalizationQueue, maintenanceQueue].map((queue) =>
        queue.obliterate({ force: true }),
      ),
    );
  });

  afterAll(async () => {
    if (documentId) await cleanupDocument(documentId);
    await db.query(
      'DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM users WHERE empid = ?)',
      [creatorEmpid],
    );
    await db.query('DELETE FROM users WHERE empid = ?', [creatorEmpid]);
    await Promise.all(
      [invitationQueue, finalizationQueue, maintenanceQueue].map((queue) =>
        queue.obliterate({ force: true }).catch(() => undefined),
      ),
    );
    await closeSecurityE2eApp(ctx);
  });

  it('HTTP commit 後只以 local ID 入列，worker 對重複 dispatch 仍只寄送及結案一次', async () => {
    const creatorCookie = await login(creatorEmpid);
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const created = apiData<DocumentDetail>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', creatorCookie)
        .set('Origin', 'http://localhost:3000')
        .field('title', 'Queue 端到端測試')
        .attach('file', Buffer.from(await pdf.save()), {
          filename: 'queue.pdf',
          contentType: 'application/pdf',
        })
        .expect(201),
    );
    documentId = Number(created.id);

    const signers = apiData<Array<{ publicId: string }>>(
      await request(ctx.server)
        .put(`/api/esign/documents/${documentId}/signers`)
        .set('Cookie', creatorCookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          signers: [
            {
              type: 'email',
              name: 'Queue 外部簽署人',
              email: 'queue-candidate@example.test',
            },
          ],
        })
        .expect(200),
    );
    await request(ctx.server)
      .put(`/api/esign/documents/${documentId}/fields`)
      .set('Cookie', creatorCookie)
      .set('Origin', 'http://localhost:3000')
      .send({
        fields: [
          {
            signerPublicId: signers[0].publicId,
            type: 'signature',
            page: 1,
            xPercent: 10,
            yPercent: 10,
            widthPercent: 25,
            heightPercent: 10,
            sortOrder: 0,
          },
        ],
      })
      .expect(200);
    await request(ctx.server)
      .post(`/api/esign/documents/${documentId}/initiations`)
      .set('Cookie', creatorCookie)
      .set('Origin', 'http://localhost:3000')
      .send({
        signers: [{ type: 'email', name: 'Queue 外部簽署人', email: 'queue-candidate@example.test' }],
        fields: Array.from({ length: 1 }, (_, index) => ({ signerIndex: index, type: 'signature', page: 1, xPercent: 10, yPercent: 10 + index * 20, widthPercent: 25, heightPercent: 10, sortOrder: index })),
        signStartAt: new Date(Date.now() - 60_000).toISOString(),
        signEndAt: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .expect(201);

    const invitationRows = await db.query<
      Array<{
        id: number;
        invitation_token_ciphertext: string;
      }>
    >(
      `SELECT l.id, s.invitation_token_ciphertext
       FROM esign_notification_logs l
       JOIN esign_signers s ON s.id = l.signer_id
       WHERE s.document_id = ?`,
      [documentId],
    );
    const notificationLogId = Number(invitationRows[0].id);
    const token = ctx.app
      .get(EsignTokenService)
      .decrypt(invitationRows[0].invitation_token_ciphertext);
    const queuedInvitation = (
      await invitationQueue.getJobs(['waiting', 'delayed'])
    ).find((job) => job.data.notificationLogId === notificationLogId);
    expect(queuedInvitation?.data).toEqual({ notificationLogId });
    expect(JSON.stringify(queuedInvitation?.data)).not.toMatch(
      /queue-candidate|token|email|pdf|png/i,
    );

    const worker = await NestFactory.createApplicationContext(WorkerModule, {
      logger: false,
    });
    try {
      await waitFor(async () => {
        const rows = await db.query<Array<{ result: string }>>(
          'SELECT result FROM esign_notification_logs WHERE id = ?',
          [notificationLogId],
        );
        return rows[0]?.result === 'delivered';
      });
      const duplicateInvitations = await Promise.all([
        invitationQueue.add(ESIGN_EXTERNAL_INVITATION_JOB, {
          notificationLogId,
        }),
        invitationQueue.add(ESIGN_EXTERNAL_INVITATION_JOB, {
          notificationLogId,
        }),
      ]);
      await waitForJobs(duplicateInvitations);
      const invitationAudits = await db.query<Array<{ count: number }>>(
        `SELECT COUNT(*) count FROM esign_audit_events
         WHERE document_id = ? AND event_type = 'external_invitation.delivered'`,
        [documentId],
      );
      expect(Number(invitationAudits[0].count)).toBe(1);

      const schedulers = await maintenanceQueue.getJobSchedulers();
      expect(schedulers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: 'esign-maintenance:30s' }),
        ]),
      );

      const session = await request(ctx.server)
        .post('/api/external-signature-session')
        .set('Origin', 'http://localhost:3000')
        .type('form')
        .send({ token })
        .expect(303);
      const accessCookie = cookieNamed(
        session.headers['set-cookie'],
        'FT_ESIGN_EXTERNAL_ACCESS',
      );
      const task = apiData<{
        fields: Array<{ id: string; type: string }>;
        consent: { version: string };
      }>(
        await request(ctx.server)
          .post('/api/external-signing-task')
          .set('Cookie', accessCookie)
          .set('Origin', 'http://localhost:3000')
          .expect(200),
      );
      await finalizationQueue.pause();
      await request(ctx.server)
        .post('/api/external-signing-task/signatures')
        .set('Cookie', accessCookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          requestId: randomUUID(),
          consentVersion: task.consent.version,
          accepted: true,
          signatures: [
            {
              fieldId: task.fields.find((field) => field.type === 'signature')!
                .id,
              pngDataUrl:
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
            },
          ],
        })
        .expect(201);

      const lostFinalizationJobs = await finalizationQueue.getJobs([
        'waiting',
        'delayed',
      ]);
      expect(
        lostFinalizationJobs.some((job) => job.data.documentId === documentId),
      ).toBe(true);
      await Promise.all(
        lostFinalizationJobs
          .filter((job) => job.data.documentId === documentId)
          .map((job) => job.remove()),
      );
      await worker
        .get(EsignMaintenanceProcessor)
        .process({ data: {} } as Job);
      const reconciledJobs = await finalizationQueue.getJobs([
        'waiting',
        'delayed',
      ]);
      expect(
        reconciledJobs.some((job) => job.data.documentId === documentId),
      ).toBe(true);
      await finalizationQueue.resume();

      await waitFor(async () => {
        const rows = await db.query<Array<{ status: string }>>(
          'SELECT status FROM esign_documents WHERE id = ?',
          [documentId],
        );
        return rows[0]?.status === 'completed';
      });
      const duplicateFinalizations = await Promise.all([
        finalizationQueue.add(ESIGN_DOCUMENT_FINALIZATION_JOB, { documentId }),
        finalizationQueue.add(ESIGN_DOCUMENT_FINALIZATION_JOB, { documentId }),
      ]);
      await waitForJobs(duplicateFinalizations);
      const completionRows = await db.query<
        Array<{ file_count: number; audit_count: number }>
      >(
        `SELECT
           (SELECT COUNT(*) FROM esign_file_objects WHERE document_id = ? AND file_purpose = 'completed_pdf') file_count,
           (SELECT COUNT(*) FROM esign_audit_events WHERE document_id = ? AND event_type = 'document.completed') audit_count`,
        [documentId, documentId],
      );
      expect(Number(completionRows[0].file_count)).toBe(1);
      expect(Number(completionRows[0].audit_count)).toBe(1);
    } finally {
      await finalizationQueue.resume().catch(() => undefined);
      await worker.close();
    }
  }, 30_000);

  async function login(empid: string): Promise<string> {
    const launched = await request(ctx.server)
      .post('/api/auth/webview-launches')
      .set('Authorization', `Bearer ${createLaunchJwt(empid)}`)
      .expect(201);
    const code = new URL(
      apiData<LaunchView>(launched).launchUrl,
    ).searchParams.get('code');
    const activated = await request(ctx.server)
      .post('/api/auth/session')
      .type('form')
      .send({ code })
      .expect(303);
    return cookieNamed(activated.headers['set-cookie'], 'FT_ESIGN_SESSION');
  }

  async function cleanupDocument(id: number): Promise<void> {
    const files = await db.query<
      Array<{ object_key: string; object_version?: string }>
    >(
      `SELECT f.object_key, f.object_version FROM esign_file_objects f
       LEFT JOIN esign_signature_records r ON r.id = f.signature_record_id
       LEFT JOIN esign_signers s ON s.id = r.signer_id
       WHERE f.document_id = ? OR s.document_id = ?`,
      [id, id],
    );
    await db.query('DELETE FROM esign_audit_events WHERE document_id = ?', [
      id,
    ]);
    await db.query(
      'DELETE FROM esign_notification_logs WHERE batch_id IN (SELECT id FROM esign_notification_batches WHERE document_id = ?)',
      [id],
    );
    await db.query(
      'DELETE FROM esign_notification_batches WHERE document_id = ?',
      [id],
    );
    await db.query(
      `DELETE f FROM esign_file_objects f
       LEFT JOIN esign_signature_records r ON r.id = f.signature_record_id
       LEFT JOIN esign_signers s ON s.id = r.signer_id
       WHERE f.document_id = ? OR s.document_id = ?`,
      [id, id],
    );
    await db.query(
      'DELETE FROM esign_signature_records WHERE signer_id IN (SELECT id FROM esign_signers WHERE document_id = ?)',
      [id],
    );
    await db.query('DELETE FROM esign_document_fields WHERE document_id = ?', [
      id,
    ]);
    await db.query('DELETE FROM esign_signers WHERE document_id = ?', [id]);
    await db.query('DELETE FROM esign_documents WHERE id = ?', [id]);
    await Promise.all(
      files.map((file) =>
        storage.delete({
          objectKey: file.object_key,
          objectVersion: file.object_version,
        }),
      ),
    );
  }
});

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('等待 queue 狀態逾時');
}

async function waitForJobs(jobs: Job[]): Promise<void> {
  await waitFor(async () => {
    const states = await Promise.all(jobs.map((job) => job.getState()));
    return states.every((state) => state === 'completed');
  });
}

function cookieNamed(value: unknown, name: string): string {
  const cookies = Array.isArray(value) ? value : [value];
  const raw = cookies.find(
    (cookie): cookie is string =>
      typeof cookie === 'string' && cookie.startsWith(`${name}=`),
  );
  if (!raw) throw new Error(`缺少 ${name} cookie`);
  return raw.split(';', 1)[0];
}

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
