import { LocalZipExports1792454403000 } from '#app/infrastructure/database/migrations/1792454403000-LocalZipExports';
import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import { DataSource } from 'typeorm';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { getQueueToken } from '@nestjs/bullmq';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { FeastogetherHrService } from '#app/infrastructure/http-client/feastogether/services/feastogether-hr.service';
import { WorkerModule } from '#app/worker.module';
import { DocumentFinalizationProcessor } from '#app/worker/esign/document-finalization.processor';
import { DocumentExportProcessor } from '#app/worker/esign/document-export.processor';
import { EsignMaintenanceProcessor } from '#app/worker/esign/esign-maintenance.processor';
import { ESIGN_DOCUMENT_FINALIZATION_QUEUE } from '#app/features/esign/esign-queue.constants';
import { EsignTokenService } from '#app/features/esign/services/esign-token.service';
import { apiData } from './api-response.helper';
import {
  closeSecurityE2eApp,
  createSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';
import {
  openExternalSession,
  openInternalEmployeeSession,
} from './external-session.helper';
import { esignTestPng } from './esign-test-png';

const origin = 'http://localhost:3000';
const note = '管理秘密009不得外洩';
interface ExportView {
  id: string;
  status: string;
  snapshotCount: number;
  expiresAt: string;
  files: Array<{ downloadPath: string; sha256: string }>;
}
function binary(
  res: IncomingMessage,
  done: (error: Error | null, body: Buffer) => void,
) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
}
function bytes(response: request.Response): Buffer {
  return response.body as Buffer;
}
function zipEntries(zip: Buffer): Buffer[] {
  const entries: Buffer[] = [];
  // 以 ZIP central directory 取得 STORE entry 的實際長度，不假設 local data descriptor 位置。
  for (let cursor = 0; cursor < zip.length - 46; cursor++) {
    if (zip.readUInt32LE(cursor) !== 0x02014b50) continue;
    expect(zip.readUInt16LE(cursor + 10)).toBe(0);
    const size = zip.readUInt32LE(cursor + 20);
    const local = zip.readUInt32LE(cursor + 42);
    const data =
      local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    entries.push(zip.subarray(data, data + size));
    cursor +=
      45 +
      zip.readUInt16LE(cursor + 28) +
      zip.readUInt16LE(cursor + 30) +
      zip.readUInt16LE(cursor + 32);
  }
  return entries;
}
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
describe('Spec009 跨故事與管理安全邊界', () => {
  let ctx: SecurityE2eContext;
  let db: DataSource;
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    ctx = await createSecurityE2eApp((builder) =>
      builder.overrideProvider(FeastogetherHrService).useValue({
        getStaffEmails: syntheticStaffEmails,
        lookupEligibleStaff: (empid: string) =>
          Promise.resolve({
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
      .set('Authorization', `Bearer ${launchJwt('E2E00910')}`)
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
      "SELECT id FROM users WHERE empid = 'E2E00910'",
    );
    userId = String(rows[0].id);
  });
  afterAll(async () => {
    if (ctx) await closeSecurityE2eApp(ctx);
  });
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

    await request(ctx.server)
      .patch(`/api/esign/documents/${created.id}/draft-settings`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({
        signers,
        signStartAt: new Date(Date.now() - 60000).toISOString(),
        signEndAt: new Date(Date.now() + 86400000).toISOString(),
        watermark: true,
        allowReject,
      })
      .expect(200);
    return apiData<Detail>(
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
          watermark: true,
          allowReject,
        })
        .expect(201),
    );
  }
  async function external(publicId: string) {
    const rows = await db.query<Array<{ invitation_token_ciphertext: string }>>(
      'SELECT invitation_token_ciphertext FROM esign_signers WHERE public_id=?',
      [publicId],
    );
    return openExternalSession(
      ctx,
      ctx.app
        .get(EsignTokenService)
        .decrypt(rows[0].invitation_token_ciphertext),
    );
  }
  async function otherEmployee() {
    const launch = await request(ctx.server)
      .post('/api/auth/webview-launches')
      .set('Authorization', `Bearer ${launchJwt('E2E00910B')}`)
      .expect(201);
    const code = new URL(
      apiData<{ launchUrl: string }>(launch).launchUrl,
    ).searchParams.get('code');
    const session = await request(ctx.server)
      .post('/api/auth/session')
      .type('form')
      .send({ code })
      .expect(303);
    return String(session.headers['set-cookie'][0]);
  }
  const read = async (id: string) =>
    apiData<Detail>(
      await request(ctx.server)
        .get(`/api/esign/documents/${id}`)
        .set('Cookie', cookie)
        .expect(200),
    );
  const saveNote = (id: string, signer: string, value: string) =>
    request(ctx.server)
      .patch(`/api/esign/documents/${id}/signers/${signer}/note`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({ note: value });
  const internalCookies = new Map<string, string>();
  async function signInternal(publicId: string) {
    const employeeCookie = await openInternalEmployeeSession(ctx, publicId);
    internalCookies.set(publicId, employeeCookie);
    const task = apiData<{
      consent: { version: string };
      fields: Array<{ id: string; type: string }>;
    }>(
      await request(ctx.server)
        .post(`/api/esign/signing-tasks/${publicId}`)
        .set('Cookie', employeeCookie)
        .set('Origin', origin)
        .expect(201),
    );
    return apiData<{ verificationUrl: string }>(
      await request(ctx.server)
        .post(`/api/esign/signing-tasks/${publicId}/signatures`)
        .set('Cookie', employeeCookie)
        .set('Origin', origin)
        .send({
          requestId: randomUUID(),
          consentVersion: task.consent.version,
          accepted: true,
          signatures: task.fields
            .filter((field) => field.type === 'signature')
            .map((field) => ({
              fieldId: field.id,
              pngDataUrl: `data:image/png;base64,${esignTestPng(10).toString('base64')}`,
            })),
        })
        .expect(201),
    );
  }
  async function finishCopy(
    worker: INestApplicationContext,
    documentId: string,
    publicId: string,
  ) {
    const rows = await db.query<Array<{ id: number }>>(
      'SELECT id FROM esign_signers WHERE public_id=?',
      [publicId],
    );
    await worker.get(DocumentFinalizationProcessor).process({
      data: { documentId: Number(documentId), signerId: rows[0].id },
    } as Job<{ documentId: number; signerId: number }>);
  }
  async function exportDocument(
    worker: INestApplicationContext,
    id: string,
    auth: string,
  ) {
    const accepted = apiData<ExportView>(
      await request(ctx.server)
        .post(`/api/esign/documents/${id}/exports`)
        .set('Cookie', auth)
        .set('Origin', origin)
        .send({ type: 'signed_copies_zip' })
        .expect(202),
    );
    const rows = await db.query<Array<{ id: number }>>(
      'SELECT id FROM esign_export_jobs WHERE public_id=?',
      [accepted.id],
    );
    await worker.get(DocumentExportProcessor).process({
      data: { exportJobId: rows[0].id },
    } as Job<{
      exportJobId: number;
    }>);
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = apiData<ExportView>(
        await request(ctx.server)
          .get(`/api/esign/documents/${id}/exports/${accepted.id}`)
          .set('Cookie', auth)
          .expect(200),
      );
      if (result.status === 'completed' || result.status === 'failed')
        return result;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('匯出 worker 未於測試期限完成');
  }
  async function evidence(id: string) {
    return {
      manifests: await db.query<unknown[]>(
        'SELECT manifest_json,manifest_sha256,audit_root_hash FROM esign_verification_records WHERE document_id=? ORDER BY id',
        [id],
      ),
      files: await db.query<unknown[]>(
        'SELECT object_key,sha256 FROM esign_file_objects WHERE document_id=? OR signature_record_id IN (SELECT r.id FROM esign_signature_records r JOIN esign_signers s ON s.id=r.signer_id WHERE s.document_id=?) ORDER BY id',
        [id, id],
      ),
      payloads: await db.query<unknown[]>(
        'SELECT signing_payload_sha256 FROM esign_signature_records WHERE signer_id IN (SELECT id FROM esign_signers WHERE document_id=?) ORDER BY id',
        [id],
      ),
    };
  }

  it('真草稿設定、浮水印副本與 ZIP bytes 相同；拒簽及待簽排除，備註不改 mixed 結案證據', async () => {
    const doc = await create([
      { type: 'user', userId },
      {
        type: 'email',
        name: '拒簽整合',
        email: 'integration-reject@example.test',
      },
      {
        type: 'email',
        name: '待簽整合',
        email: 'integration-pending@example.test',
      },
    ]);
    const [internal, rejected, pending] = doc.signers;
    const rejectCookie = await external(rejected.publicId);
    const pendingCookie = await external(pending.publicId);
    await saveNote(doc.id, rejected.publicId, note).expect(200);
    const signed = await signInternal(internal.publicId);
    const rejectBody = {
      signerPublicId: rejected.publicId,
      requestId: randomUUID(),
      reason: '不同意',
    };
    const rejectResponse = await request(ctx.server)
      .post('/api/external-signing-task/rejection')
      .set('Cookie', rejectCookie)
      .set('Origin', origin)
      .send(rejectBody)
      .expect(201);
    expect(JSON.stringify(rejectResponse.body)).not.toContain(note);
    const worker = await NestFactory.createApplicationContext(WorkerModule, {
      logger: false,
    });
    try {
      await finishCopy(worker, doc.id, internal.publicId);
      expect((await read(doc.id)).status).toBe('active');
      const personal = bytes(
        await request(ctx.server)
          .get(`/api/esign/signing-tasks/${internal.publicId}/completed-file`)
          .set('Cookie', internalCookies.get(internal.publicId)!)
          .buffer(true)
          .parse(binary)
          .expect(200),
      );
      expect((await PDFDocument.load(personal)).getPageCount()).toBe(1);
      const other = await otherEmployee();
      const exported = await exportDocument(worker, doc.id, other);
      expect(exported.status).toBe('completed');
      const runner = db.createQueryRunner();
      try {
        await expect(
          new LocalZipExports1792454403000().down(runner),
        ).rejects.toThrow('已有匯出快照');
      } finally {
        await runner.release();
      }
      const zip = bytes(
        await request(ctx.server)
          .get(exported.files[0].downloadPath)
          .set('Cookie', other)
          .buffer(true)
          .parse(binary)
          .expect(200),
      );
      const entries = zipEntries(zip);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual(personal);
      expect(createHash('sha256').update(zip).digest('hex')).toBe(
        exported.files[0].sha256,
      );
      const queue = ctx.app.get<Queue>(
        getQueueToken(ESIGN_DOCUMENT_FINALIZATION_QUEUE),
      );
      const lost = jest
        .spyOn(queue, 'add')
        .mockRejectedValueOnce(
          new Error('synthetic lost finalization enqueue'),
        );
      try {
        await request(ctx.server)
          .post('/api/external-signing-task/rejection')
          .set('Cookie', pendingCookie)
          .set('Origin', origin)
          .send({ signerPublicId: pending.publicId, requestId: randomUUID() })
          .expect(201);
      } finally {
        lost.mockRestore();
      }
      await worker.get(EsignMaintenanceProcessor).process({} as Job);
      expect((await read(doc.id)).status).toBe('completed');
      const before = await evidence(doc.id);
      await saveNote(doc.id, internal.publicId, note).expect(200);
      await saveNote(doc.id, rejected.publicId, '').expect(200);
      await request(ctx.server)
        .get(`/api/esign/documents/${doc.id}/notification-batches`)
        .set('Cookie', cookie)
        .expect(200);
      const reused = apiData<ExportView>(
        await request(ctx.server)
          .post(`/api/esign/documents/${doc.id}/exports`)
          .set('Cookie', cookie)
          .set('Origin', origin)
          .send({ type: 'signed_copies_zip' })
          .expect(200),
      );
      expect(reused.id).toBe(exported.id);
      expect(reused.expiresAt).toBe(exported.expiresAt);
      expect(await evidence(doc.id)).toEqual(before);
      expect(
        bytes(
          await request(ctx.server)
            .get(`/api/esign/signing-tasks/${internal.publicId}/completed-file`)
            .set('Cookie', internalCookies.get(internal.publicId)!)
            .buffer(true)
            .parse(binary)
            .expect(200),
        ),
      ).toEqual(personal);
      await request(ctx.server)
        .get(
          `/api/signature-verifications/${signed.verificationUrl.split('/').at(-1)}`,
        )
        .expect(200);
      // 同長度 local 成果改寫不可默默重建，也不能以 Range 繞過版本檢查。
      const rows = await db.query<Array<{ object_key: string }>>(
        'SELECT object_key FROM esign_file_objects WHERE export_job_id=(SELECT id FROM esign_export_jobs WHERE public_id=?)',
        [exported.id],
      );
      const path = join(process.env.ESIGN_STORAGE_ROOT!, rows[0].object_key);
      const damaged = await readFile(path);
      damaged[0] ^= 1;
      await writeFile(path, damaged);
      await request(ctx.server)
        .get(exported.files[0].downloadPath)
        .set('Cookie', other)
        .set('Range', 'bytes=0-3')
        .expect(503);
      await request(ctx.server)
        .post(`/api/esign/documents/${doc.id}/exports`)
        .set('Cookie', other)
        .set('Origin', origin)
        .send({ type: 'signed_copies_zip' })
        .expect(503);
      const unchanged = apiData<ExportView>(
        await request(ctx.server)
          .get(`/api/esign/documents/${doc.id}/exports/${exported.id}`)
          .set('Cookie', other)
          .expect(200),
      );
      expect(unchanged.expiresAt).toBe(exported.expiresAt);
    } finally {
      await worker.close();
    }
  });

  it('有效員工匯出可跨建立人，管理 API 仍受建立人、Origin、歸屬及外部 session 邊界保護', async () => {
    const doc = await create([
      { type: 'user', userId },
      { type: 'email', name: '本人 A', email: 'private-a@example.test' },
      { type: 'email', name: '他人 B 不可見', email: 'private-b@example.test' },
    ]);
    const [internal, a, b] = doc.signers;
    const aCookie = await external(a.publicId);
    const other = await otherEmployee();
    await saveNote(doc.id, a.publicId, note).expect(200);
    const base = `/api/esign/documents/${doc.id}`;
    const batch = apiData<{ batchId: string }>(
      await request(ctx.server)
        .post(`${base}/notification-batches`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send({
          requestId: randomUUID(),
          selection: 'selected',
          signerPublicIds: [a.publicId],
        })
        .expect(202),
    );
    const management = [
      {
        method: 'patch',
        path: `${base}/draft-settings`,
        body: { watermark: false },
      },
      {
        method: 'patch',
        path: `${base}/signers/${a.publicId}/note`,
        body: { note: '越權' },
      },
      {
        method: 'post',
        path: `${base}/notification-batches`,
        body: { requestId: randomUUID(), selection: 'all_pending' },
      },
    ] as const;
    for (const item of management) {
      await request(ctx.server)
        [item.method](item.path)
        .set('Cookie', other)
        .set('Origin', origin)
        .send(item.body)
        .expect(404);
      for (const auth of ['', aCookie]) {
        const call = request(ctx.server)
          [item.method](item.path)
          .set('Origin', origin)
          .send(item.body);
        if (auth) call.set('Cookie', auth);
        await call.expect(401);
      }
      for (const badOrigin of ['', 'https://invalid.example.test']) {
        const call = request(ctx.server)
          [item.method](item.path)
          .set('Cookie', cookie)
          .send(item.body);
        if (badOrigin) call.set('Origin', badOrigin);
        await call.expect(403);
      }
    }
    for (const path of [
      `${base}/notification-batches`,
      `${base}/notification-batches/${batch.batchId}`,
    ])
      await request(ctx.server).get(path).set('Cookie', other).expect(404);
    await request(ctx.server)
      .patch(`${base}/signers/${randomUUID()}/note`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({ note: '錯對象' })
      .expect(404);
    await request(ctx.server)
      .post('/api/external-signing-task/rejection')
      .set('Cookie', aCookie)
      .set('Origin', origin)
      .send({ signerPublicId: b.publicId, requestId: randomUUID() })
      .expect(409);
    const view = await request(ctx.server)
      .get('/api/external-signing-task')
      .set('Cookie', aCookie)
      .expect(200);
    for (const secret of [
      note,
      b.publicId,
      'private-b@example.test',
      '他人 B 不可見',
    ])
      expect(JSON.stringify(view.body)).not.toContain(secret);
    expect(
      (await read(doc.id)).signers.every(
        (signer) => signer.status === 'pending',
      ),
    ).toBe(true);
    await request(ctx.server)
      .post('/api/external-signing-task/rejection')
      .set('Cookie', aCookie)
      .set('Origin', origin)
      .send({ signerPublicId: a.publicId, requestId: randomUUID() })
      .expect(201);
    const rejectedView = await request(ctx.server)
      .get('/api/external-signing-task')
      .set('Cookie', aCookie)
      .expect(200);
    for (const secret of [note, b.publicId, 'private-b@example.test'])
      expect(JSON.stringify(rejectedView.body)).not.toContain(secret);
    await signInternal(internal.publicId);
    const worker = await NestFactory.createApplicationContext(WorkerModule, {
      logger: false,
    });
    try {
      await finishCopy(worker, doc.id, internal.publicId);
      const exported = await exportDocument(worker, doc.id, other);
      let history: { items: Array<{ status: string }> } = { items: [] };
      for (let attempt = 0; attempt < 100; attempt++) {
        history = apiData<{ items: Array<{ status: string }> }>(
          await request(ctx.server)
            .get(`${base}/notification-batches/${batch.batchId}`)
            .set('Cookie', cookie)
            .expect(200),
        );
        if (history.items[0]?.status === 'skipped') break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(history.items[0].status).toBe('skipped');
      expect(JSON.stringify(history)).not.toContain(note);
      const reads = [
        '/api/esign/exportable-documents',
        '/api/esign/history/export?type=zip',
        `${base}/exports/${exported.id}`,
        exported.files[0].downloadPath,
      ];
      for (const path of reads)
        for (const auth of ['', aCookie]) {
          const call = request(ctx.server).get(path);
          if (auth) call.set('Cookie', auth);
          await call.expect(401);
        }
      for (const path of [
        `${base}/exports`,
        `${base}/exports/${exported.id}/retries`,
      ]) {
        for (const auth of ['', aCookie]) {
          const call = request(ctx.server)
            .post(path)
            .set('Origin', origin)
            .send({ type: 'signed_copies_zip' });
          if (auth) call.set('Cookie', auth);
          await call.expect(401);
        }
        for (const badOrigin of ['', 'https://invalid.example.test']) {
          const call = request(ctx.server)
            .post(path)
            .set('Cookie', other)
            .send({ type: 'signed_copies_zip' });
          if (badOrigin) call.set('Origin', badOrigin);
          await call.expect(403);
        }
      }
      for (const path of [
        `/api/esign/documents/99999999/exports/${exported.id}`,
        exported.files[0].downloadPath.replace(
          `/documents/${doc.id}/`,
          '/documents/99999999/',
        ),
        exported.files[0].downloadPath.replace(
          /\/files\/\d+$/,
          '/files/99999999',
        ),
      ])
        await request(ctx.server).get(path).set('Cookie', other).expect(404);
      const before = await db.query<unknown[]>(
        'SELECT (SELECT COUNT(*) FROM esign_export_jobs) AS jobs,(SELECT COUNT(*) FROM esign_audit_events) AS events',
      );
      for (const path of reads.slice(0, 3))
        await request(ctx.server).get(path).set('Cookie', other).expect(200);
      expect(
        await db.query<unknown[]>(
          'SELECT (SELECT COUNT(*) FROM esign_export_jobs) AS jobs,(SELECT COUNT(*) FROM esign_audit_events) AS events',
        ),
      ).toEqual(before);
    } finally {
      await worker.close();
    }
  });
  it('既有全簽 v2 manifest 與副本經備註、匯出、重送結案後均不變', async () => {
    const doc = await create([{ type: 'user', userId }]);
    const signed = await signInternal(doc.signers[0].publicId);
    const worker = await NestFactory.createApplicationContext(WorkerModule, {
      logger: false,
    });
    try {
      await finishCopy(worker, doc.id, doc.signers[0].publicId);
      expect((await read(doc.id)).status).toBe('completed');
      const before = await evidence(doc.id);
      expect(JSON.stringify(before.manifests)).toContain(
        'esign-verification-manifest-v2',
      );
      await saveNote(doc.id, doc.signers[0].publicId, note).expect(200);
      await exportDocument(worker, doc.id, await otherEmployee());
      await saveNote(doc.id, doc.signers[0].publicId, '').expect(200);
      await worker
        .get(DocumentFinalizationProcessor)
        .finalizeDocument(Number(doc.id));
      expect(await evidence(doc.id)).toEqual(before);
      await request(ctx.server)
        .get(
          `/api/signature-verifications/${signed.verificationUrl.split('/').at(-1)}`,
        )
        .expect(200);
    } finally {
      await worker.close();
    }
  });
});
import { syntheticStaffEmails } from './synthetic-staff-emails.helper';
