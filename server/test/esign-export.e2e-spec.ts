import { EsignDocument } from '#app/features/esign/entities/esign-document.entity';
import { User } from '#app/features/users/entities/user.entity';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DocumentExportProcessor } from '#app/worker/esign/document-export.processor';
import { EsignExportJob } from '#app/features/esign/entities/esign-export-job.entity';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { ESIGN_EXPORT_QUEUE } from '#app/features/esign/esign-queue.constants';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { EsignSigner } from '#app/features/esign/entities/esign-signer.entity';
import { EsignSignatureRecord } from '#app/features/esign/entities/esign-signature-record.entity';
import { EsignFileObject } from '#app/features/esign/entities/esign-file-object.entity';
import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import { DataSource } from 'typeorm';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { FeastogetherHrService } from '#app/infrastructure/http-client/feastogether/services/feastogether-hr.service';
import { apiData } from './api-response.helper';
import {
  createSecurityE2eApp,
  createSyntheticWorker,
  closeSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

jest.setTimeout(30_000);

describe('Spec009 匯出 API', () => {
  let ctx: SecurityE2eContext;
  let db: DataSource;
  let cookie: string;
  let other: string;
  let outsider: string;
  let missing: string;
  let id: string;
  let ownerId: string;
  const origin = 'http://localhost:3000';
  beforeAll(async () => {
    ctx = await createSecurityE2eApp((builder) =>
      builder.overrideProvider(FeastogetherHrService).useValue({
        getStaffEmails: syntheticStaffEmails,
        lookupEligibleStaff: (empid: string) =>
          Promise.resolve({
            person_empid: empid,
            person_name: '草稿測試員工',
            person_status: 1,
            person_status_name: '正式',
            department_id:
              empid === 'EXPORT00903'
                ? 'OTHER009'
                : empid === 'EXPORT00904'
                  ? null
                  : 'D009',
            department_name: '測試部',
            title: '測試員工',
          }),
      }),
    );
    db = ctx.app.get<DataSource>(MYSQL_MAIN);
    cookie = await login('EXPORT00901');
    other = await login('EXPORT00902');
    outsider = await login('EXPORT00903');
    missing = await login('EXPORT00904');
    const users = await db.query<Array<{ id: number }>>(
      "SELECT id FROM users WHERE empid='EXPORT00901'",
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
  });

  it('部門隔離：跨部門查找不可見，建立／重用請求拒絕且無 DB 或 queue 副作用', async () => {
    const list = apiData<{ items: Array<{ documentId: string }> }>(
      await request(ctx.server)
        .get('/api/esign/exportable-documents')
        .set('Cookie', outsider)
        .expect(200),
    );
    expect(list.items.some((item) => item.documentId === id)).toBe(false);
    const before = await db.manager.count(EsignExportJob);
    const queue = ctx.app.get<Queue>(getQueueToken(ESIGN_EXPORT_QUEUE));
    const enqueue = jest.spyOn(queue, 'add');
    try {
      await request(ctx.server)
        .post(`/api/esign/documents/${id}/exports`)
        .set('Cookie', outsider)
        .set('Origin', origin)
        .send({ type: 'signed_copies_zip' })
        .expect(404);
      await request(ctx.server)
        .post(`/api/esign/documents/${id}/exports`)
        .set('Cookie', missing)
        .set('Origin', origin)
        .send({ type: 'signed_copies_zip' })
        .expect(409);
      expect(await db.manager.count(EsignExportJob)).toBe(before);
      expect(enqueue).not.toHaveBeenCalled();
    } finally {
      enqueue.mockRestore();
    }
  });

  it('同部門員工可跨建立人查找，但空文件不能匯出', async () => {
    const list = apiData<{ items: Array<{ documentId: string }> }>(
      await request(ctx.server)
        .get('/api/esign/exportable-documents')
        .set('Cookie', other)
        .expect(200),
    );
    expect(list.items.some((item) => item.documentId === id)).toBe(true);
    await request(ctx.server)
      .post(`/api/esign/documents/${id}/exports`)
      .set('Cookie', other)
      .set('Origin', origin)
      .send({ type: 'signed_copies_zip' })
      .expect(409);
    await db.manager.save(
      EsignSigner,
      db.manager.create(EsignSigner, {
        publicId: randomUUID(),
        documentId: Number(id),
        signerType: 'email',
        email: 'rejected@example.test',
        nameSnapshot: '已拒測試者',
        status: 'rejected',
        rejectedAt: new Date(),
        rejectReason: '拒絕測試',
        rejectRequestId: randomUUID(),
        sortOrder: 0,
      }),
    );
    await request(ctx.server)
      .post(`/api/esign/documents/${id}/exports`)
      .set('Cookie', other)
      .set('Origin', origin)
      .send({ type: 'signed_copies_zip' })
      .expect(409);
    await request(ctx.server)
      .post(`/api/esign/documents/${id}/exports`)
      .set('Cookie', other)
      .send({ type: 'signed_copies_zip' })
      .expect(403);
    await request(ctx.server)
      .get('/api/esign/exportable-documents')
      .expect(401);
    await request(ctx.server)
      .get('/api/esign/exportable-documents?limit=101')
      .set('Cookie', other)
      .expect(400);
    // Spec 015 移除只供舊 /exports 使用的 documentId，帶這個未知參數回 400。
    await request(ctx.server)
      .get(`/api/esign/exportable-documents?documentId=${id}`)
      .set('Cookie', other)
      .expect(400);
  });

  it('兩員工共用固定快照，worker 完成 ZIP 後可原生續傳', async () => {
    const signer = await db.manager.save(
      EsignSigner,
      db.manager.create(EsignSigner, {
        publicId: randomUUID(),
        documentId: Number(id),
        signerType: 'user',
        userId: Number(ownerId),
        empidSnapshot: 'EXPORT00901',
        nameSnapshot: '../合成簽署人',
        status: 'signed',
        signedAt: new Date(),
        completionStatus: 'ready',
        completionReadyAt: new Date(),
        sortOrder: 1,
      }),
    );
    const record = await db.manager.save(
      EsignSignatureRecord,
      db.manager.create(EsignSignatureRecord, {
        signerId: signer.id,
        documentSha256: 'a'.repeat(64),
        signingPayloadSha256: 'b'.repeat(64),
        consentVersion: 'test',
        authenticationMethod: 'test',
        authenticationEventId: randomUUID(),
        signedAtUtc: new Date(),
      }),
    );
    const storage = ctx.app.get<PrivateFileStorage>(PRIVATE_FILE_STORAGE);
    const stored = await storage.store({
      directory: `documents/export-test-${id}`,
      extension: 'pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from('%PDF synthetic signed bytes'),
    });
    await db.manager.save(
      EsignFileObject,
      db.manager.create(EsignFileObject, {
        ...stored,
        signatureRecordId: record.id,
        filePurpose: 'completed_pdf',
        archiveStatus: 'active',
      }),
    );
    const make = (auth: string) =>
      request(ctx.server)
        .post(`/api/esign/documents/${id}/exports`)
        .set('Cookie', auth)
        .set('Origin', origin)
        .send({ type: 'signed_copies_zip' });
    // Redis enqueue 故障不可回滾已受理的快照；maintenance 稍後補列。
    const producerQueue = ctx.app.get<Queue>(getQueueToken(ESIGN_EXPORT_QUEUE));
    const enqueueFailure = jest
      .spyOn(producerQueue, 'add')
      .mockRejectedValue(new Error('合成 Redis enqueue 故障'));
    const [a, b] = await Promise.all([make(cookie), make(other)]);
    enqueueFailure.mockRestore();
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    const job = apiData<{ id: string; expectedCount: number }>(a);
    expect(apiData<{ id: string }>(b).id).toBe(job.id);
    expect(job.expectedCount).toBe(1);
    const worker = await createSyntheticWorker(ctx);
    try {
      await worker.get(DocumentExportProcessor).maintain();
      let result:
        | {
            status: string;
            files: Array<{
              downloadPath: string;
              sha256: string;
              size: number;
            }>;
          }
        | undefined;
      for (let i = 0; i < 100; i++) {
        result = apiData(
          await request(ctx.server)
            .get(`/api/esign/documents/${id}/exports/${job.id}`)
            .set('Cookie', other)
            .expect(200),
        );
        if (result?.status === 'completed' || result?.status === 'failed')
          break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(result?.status).toBe('completed');
      const file = result!.files[0];
      // Spec020：只改當次建議名稱，兩員工共用成果與歷史維持不變。
      const originalDocument = await db.manager.findOneByOrFail(EsignDocument, {
        id: Number(id),
      });
      await db.query(
        'UPDATE esign_documents SET status = ?, sign_start_at = ?, sign_end_at = ? WHERE id = ?',
        [
          'active',
          new Date(Date.now() - 86_400_000),
          new Date(Date.now() + 86_400_000),
          id,
        ],
      );
      try {
        const beforeJobs = await db.manager.find(EsignExportJob, {
          where: { documentId: Number(id) },
        });
        const beforeFiles = await db.manager.find(EsignFileObject, {
          where: { exportJobId: beforeJobs[0].id },
        });
        const beforeQueues = await producerQueue.getJobCounts();
        const fileId = file.downloadPath.split('/').at(-1)!;
        const prepare = (auth: string, fileName: string, override = {}) =>
          request(ctx.server)
            .post(`/api/esign/documents/${id}/export-downloads`)
            .set('Cookie', auth)
            .set('Origin', origin)
            .send({
              type: 'zip',
              exportId: job.id,
              fileId,
              fileName,
              ...override,
            });
        const [first, second] = await Promise.all([
          prepare(cookie, '合成甲.xlsx').expect(200),
          prepare(other, '合成乙.zip').expect(200),
        ]);
        const a = apiData<{ fileName: string; downloadPath: string }>(first);
        const b = apiData<{ fileName: string; downloadPath: string }>(second);
        expect(a.fileName).toBe('合成甲.zip');
        expect(b.fileName).toBe('合成乙.zip');
        expect(a.downloadPath).toBe(`${file.downloadPath}?downloadName=client`);
        expect(b.downloadPath).toBe(a.downloadPath);
        expect(a.downloadPath).not.toContain('合成');
        const named = await request(ctx.server)
          .get(a.downloadPath)
          .set('Cookie', other)
          .set('Range', 'bytes=0-3')
          .expect(206);
        expect(named.headers['content-disposition']).toBe('attachment');
        expect(named.headers.etag).toBe(`"${file.sha256}"`);
        const defaultName = apiData<{ downloadPath: string }>(
          await prepare(cookie, ' ').expect(200),
        );
        expect(defaultName.downloadPath).toBe(file.downloadPath);
        await prepare(outsider, '禁止').expect(404);
        await prepare(other, '禁止', { fileId: '999999999999999' }).expect(404);
        await prepare(other, '禁止', { exportId: randomUUID() }).expect(404);
        await prepare(other, '../禁止').expect(400);
        await request(ctx.server)
          .get(a.downloadPath)
          .set('Cookie', outsider)
          .expect(404);
        expect(
          await db.manager.find(EsignExportJob, {
            where: { documentId: Number(id) },
          }),
        ).toEqual(beforeJobs);
        expect(
          await db.manager.find(EsignFileObject, {
            where: { exportJobId: beforeJobs[0].id },
          }),
        ).toEqual(beforeFiles);
        expect(await producerQueue.getJobCounts()).toEqual(beforeQueues);
      } finally {
        await db.query(
          'UPDATE esign_documents SET status = ?, sign_start_at = ?, sign_end_at = ? WHERE id = ?',
          [
            originalDocument.status,
            originalDocument.signStartAt ?? null,
            originalDocument.signEndAt ?? null,
            id,
          ],
        );
      }
      const beforeDenied = await db.manager.count(EsignExportJob);
      const queueBeforeDenied = await producerQueue.getJobCounts();
      await request(ctx.server)
        .get(`/api/esign/documents/${id}/exports/${job.id}`)
        .set('Cookie', outsider)
        .expect(404);
      await request(ctx.server)
        .post(`/api/esign/documents/${id}/exports/${job.id}/retries`)
        .set('Cookie', outsider)
        .set('Origin', origin)
        .expect(404);
      await make(outsider).expect(404);
      await request(ctx.server)
        .get(file.downloadPath)
        .set('Cookie', outsider)
        .set('Range', 'bytes=0-3')
        .expect(404);
      await request(ctx.server)
        .get(file.downloadPath)
        .set('Cookie', missing)
        .expect(409);
      expect(await db.manager.count(EsignExportJob)).toBe(beforeDenied);
      expect(await producerQueue.getJobCounts()).toEqual(queueBeforeDenied);
      // 原建立人調職後不能藉建立人或舊網址取得一般匯出；同部門同事仍可下載。
      await db.manager.update(
        User,
        { id: Number(ownerId) },
        { departmentCode: 'OTHER009' },
      );
      try {
        await request(ctx.server)
          .get(file.downloadPath)
          .set('Cookie', cookie)
          .expect(404);
        await make(cookie).expect(404);
      } finally {
        await db.manager.update(
          User,
          { id: Number(ownerId) },
          { departmentCode: 'D009' },
        );
      }

      const download = await request(ctx.server)
        .get(file.downloadPath)
        .set('Cookie', other)
        .set('Range', 'bytes=0-3')
        .expect(206);
      expect(download.headers['content-range']).toBe(`bytes 0-3/${file.size}`);
      expect(download.headers.etag).toBe(`"${file.sha256}"`);
      const reused = apiData<{ id: string }>(await make(other).expect(200));
      expect(reused.id).toBe(job.id);
      await request(ctx.server).get(file.downloadPath).expect(401);
      await request(ctx.server)
        .get(file.downloadPath)
        .set('Cookie', 'esign_external_access=invalid')
        .expect(401);
      await request(ctx.server)
        .get(file.downloadPath)
        .set('Cookie', other)
        .set('Range', `bytes=${file.size}-`)
        .expect(416);
      await request(ctx.server)
        .get(file.downloadPath)
        .set('Cookie', other)
        .set('Range', 'bytes=0-3')
        .set('If-Range', '"different"')
        .expect(200);
      await request(ctx.server)
        .get(file.downloadPath)
        .set('Cookie', other)
        .set('Range', 'bytes=0-3,6-7')
        .expect(200);
      await request(ctx.server)
        .get(
          file.downloadPath.replace(`/documents/${id}/`, '/documents/999999/'),
        )
        .set('Cookie', other)
        .expect(404);
      // 在固定快照之後增加簽署：往後仍不新增工作或混入新副本。
      const secondSigner = await db.manager.save(
        EsignSigner,
        db.manager.create(EsignSigner, {
          publicId: randomUUID(),
          documentId: Number(id),
          signerType: 'email',
          email: 'snapshot@example.test',
          nameSnapshot: '後來簽署',
          status: 'signed',
          signedAt: new Date(),
          completionStatus: 'processing',
          completionLeaseToken: randomUUID(),
          completionLeaseExpiresAt: new Date(Date.now() + 60_000),
          sortOrder: 2,
        }),
      );
      await db.manager.save(
        EsignSignatureRecord,
        db.manager.create(EsignSignatureRecord, {
          signerId: secondSigner.id,
          documentSha256: 'c'.repeat(64),
          signingPayloadSha256: 'd'.repeat(64),
          consentVersion: 'test',
          authenticationMethod: 'test',
          authenticationEventId: randomUUID(),
          signedAtUtc: new Date(),
        }),
      );
      expect(apiData(await make(other).expect(200))).toMatchObject({
        id: job.id,
        expectedCount: 1,
      });
      const before = await db.manager.findOneByOrFail(EsignExportJob, {
        publicId: job.id,
      });
      await request(ctx.server)
        .get(`/api/esign/documents/${id}/exports/${job.id}`)
        .set('Cookie', other)
        .expect(200);
      expect(
        (await db.manager.findOneByOrFail(EsignExportJob, { publicId: job.id }))
          .updatedAt,
      ).toEqual(before.updatedAt);
      expect(before.expiresAt).toBeNull();
      // 舊期限也不再阻擋成果，maintenance 經過一年仍保留原檔。
      await db.manager.update(
        EsignExportJob,
        { id: before.id },
        {
          expiresAt: new Date(Date.now() - 1),
        },
      );
      for (const days of [8, 365]) {
        await worker
          .get(DocumentExportProcessor)
          .maintain(new Date(Date.now() + days * 24 * 60 * 60_000));
        expect(apiData(await make(other).expect(200))).toMatchObject({
          id: job.id,
          expectedCount: 1,
          expiresAt: null,
        });
        await request(ctx.server)
          .get(file.downloadPath)
          .set('Cookie', other)
          .set('Range', 'bytes=0-3')
          .expect(206);
      }
      const newerFailure = await db.manager.save(
        EsignExportJob,
        db.manager.create(EsignExportJob, {
          publicId: randomUUID(),
          documentId: Number(id),
          createdByUserId: Number(ownerId),
          exportType: 'signed_copies_zip',
          status: 'failed',
          scopeDescription: '合成失敗工作',
          snapshotAt: new Date(),
          snapshotJson: before.snapshotJson,
          snapshotSha256: before.snapshotSha256,
          recordCount: 1,
          processedCount: 0,
          waitingCount: 0,
          attemptCount: 0,
        }),
      );
      const detail = apiData<{ exportSummary: { id: string } }>(
        await request(ctx.server)
          .get(`/api/esign/documents/${id}`)
          .set('Cookie', cookie)
          .expect(200),
      );
      expect(detail.exportSummary.id).toBe(job.id);
      await db.query(
        "UPDATE esign_documents SET status='active',sign_start_at=UTC_TIMESTAMP(),sign_end_at=DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 DAY) WHERE id=?",
        [id],
      );
      // Spec017 × Spec019：同部門唯讀與匯出預覽採同一固定工作。
      for (const suffix of ['', '?view=export']) {
        const peer = apiData<{ exportSummary: { id: string } }>(
          await request(ctx.server)
            .get(`/api/esign/documents/${id}${suffix}`)
            .set('Cookie', other)
            .expect(200),
        );
        expect(peer.exportSummary.id).toBe(job.id);
        await request(ctx.server)
          .get(`/api/esign/documents/${id}${suffix}`)
          .set('Cookie', outsider)
          .expect(404);
      }
      await db.manager.update(
        User,
        { id: Number(ownerId) },
        { departmentCode: 'TRANSFERRED' },
      );
      try {
        const moved = apiData<{ canExport: boolean; exportSummary: unknown }>(
          await request(ctx.server)
            .get(`/api/esign/documents/${id}`)
            .set('Cookie', cookie)
            .expect(200),
        );
        expect(moved.canExport).toBe(false);
        expect(moved.exportSummary).toBeNull();
        await request(ctx.server)
          .get(`/api/esign/documents/${id}?view=export`)
          .set('Cookie', cookie)
          .expect(404);
      } finally {
        await db.manager.update(
          User,
          { id: Number(ownerId) },
          { departmentCode: 'D009' },
        );
      }

      expect(
        apiData(
          await request(ctx.server)
            .post(
              `/api/esign/documents/${id}/exports/${newerFailure.publicId}/retries`,
            )
            .set('Cookie', other)
            .set('Origin', origin)
            .expect(200),
        ),
      ).toMatchObject({ id: job.id });
      // 原成果遺失後，即使有其他工作也不能重建或重新選取。
      const lost = await db.manager.findOneByOrFail(EsignFileObject, {
        exportJobId: before.id,
        filePurpose: 'signed_copies_zip',
      });
      await storage.delete(lost);
      await Promise.all([make(other).expect(503), make(cookie).expect(503)]);
      await request(ctx.server)
        .get(file.downloadPath)
        .set('Cookie', other)
        .expect(503);
      await request(ctx.server)
        .post(
          `/api/esign/documents/${id}/exports/${newerFailure.publicId}/retries`,
        )
        .set('Cookie', other)
        .set('Origin', origin)
        .expect(503);
      await db.manager.update(
        EsignExportJob,
        { id: before.id },
        { status: 'expired' },
      );
      await make(other).expect(503);
      expect(
        apiData(
          await request(ctx.server)
            .get(`/api/esign/documents/${id}/exports/${job.id}`)
            .set('Cookie', other)
            .expect(200),
        ),
      ).toMatchObject({ status: 'expired', files: [] });

      // 後續 worker 復原測試使用另一份合成文件，不再靠到期建立第二個工作。
      const freshDocument = async () => {
        const oldId = id;
        id = apiData<{ id: string }>(
          await request(ctx.server)
            .post('/api/esign/documents')
            .set('Cookie', cookie)
            .set('Origin', origin)
            .field('title', '獨立匯出復原案例')
            .attach(
              'file',
              Buffer.from(
                await (async () => {
                  const pdf = await PDFDocument.create();
                  pdf.addPage();
                  return pdf.save();
                })(),
              ),
              { filename: 'export.pdf', contentType: 'application/pdf' },
            )
            .expect(201),
        ).id;
        await db.manager.update(
          EsignSigner,
          { documentId: Number(oldId) },
          { documentId: Number(id) },
        );
      };
      await freshDocument();
      const next = apiData<{ id: string; expectedCount: number }>(
        await make(other).expect(202),
      );
      expect(next.expectedCount).toBe(2);
      // 等待缺少的既有副本，不能以已有的一份發布不完整成果。
      for (let i = 0; i < 100; i++) {
        const state = apiData<{ status: string; files: unknown[] }>(
          await request(ctx.server)
            .get(`/api/esign/documents/${id}/exports/${next.id}`)
            .set('Cookie', other)
            .expect(200),
        );
        if (state.status === 'waiting') {
          expect(state.files).toEqual([]);
          break;
        }
        if (i === 99) throw new Error('工作未進入等待副本狀態');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const queue = ctx.app.get<Queue>(getQueueToken(ESIGN_EXPORT_QUEUE));
      expect(await queue.getGlobalConcurrency()).toBe(1);
      // 既有副本明確失敗時，工作必須停止等待並提供可重試結果。
      await db.manager.update(
        EsignSigner,
        { id: secondSigner.id },
        {
          completionStatus: 'failed',
          completionLeaseToken: null,
          completionLeaseExpiresAt: null,
        },
      );
      await db.manager.update(
        EsignExportJob,
        { publicId: next.id },
        { nextAttemptAt: new Date(0) },
      );
      await worker.get(DocumentExportProcessor).maintain();
      const state = async (jobId: string) =>
        apiData<{
          status: string;
          failureCode: string;
          expectedCount: number;
          files: Array<{ downloadPath: string }>;
        }>(
          await request(ctx.server)
            .get(`/api/esign/documents/${id}/exports/${jobId}`)
            .set('Cookie', other)
            .expect(200),
        );
      const waitFor = async (jobId: string, status: string) => {
        for (let i = 0; i < 100; i++) {
          const value = await state(jobId);
          if (value.status === status) return value;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(`工作未進入 ${status}`);
      };
      expect(await waitFor(next.id, 'failed')).toMatchObject({
        failureCode: 'ESIGN_EXPORT_SOURCE_FAILED',
        files: [],
      });
      const secondRecord = await db.manager.findOneByOrFail(
        EsignSignatureRecord,
        { signerId: secondSigner.id },
      );
      const secondFile = await storage.store({
        directory: `documents/export-test-${id}`,
        extension: 'pdf',
        mimeType: 'application/pdf',
        bytes: Buffer.from('%PDF second copy'),
      });
      await db.manager.save(
        EsignFileObject,
        db.manager.create(EsignFileObject, {
          ...secondFile,
          signatureRecordId: secondRecord.id,
          filePurpose: 'completed_pdf',
          archiveStatus: 'active',
        }),
      );
      await db.manager.update(
        EsignSigner,
        { id: secondSigner.id },
        { completionStatus: 'ready', completionReadyAt: new Date() },
      );
      const retried = apiData<{ id: string }>(
        await request(ctx.server)
          .post(`/api/esign/documents/${id}/exports/${next.id}/retries`)
          .set('Cookie', other)
          .set('Origin', origin)
          .expect(202),
      );
      expect(retried.id).toBe(next.id);
      expect(await waitFor(next.id, 'completed')).toMatchObject({
        failureCode: null,
        expectedCount: 2,
      });
      // storage 已落檔後租約被下一 generation 接管：舊 worker 不可發布。
      await queue.pause();
      await freshDocument();
      const fenced = apiData<{ id: string }>(await make(other).expect(202));
      const workerStorage =
        worker.get<PrivateFileStorage>(PRIVATE_FILE_STORAGE);
      const storeStream = workerStorage.storeStream!.bind(workerStorage);
      let releaseFence: () => void = () => undefined;
      const fenceApplied = new Promise<void>((resolve) => {
        releaseFence = resolve;
      });
      let abandonedKey = '';
      const fault = jest
        .spyOn(workerStorage, 'storeStream')
        .mockImplementationOnce(async (input) => {
          const file = await storeStream(input);
          abandonedKey = file.objectKey;
          await db.manager.update(
            EsignExportJob,
            { publicId: fenced.id },
            {
              leaseToken: randomUUID(),
              leaseExpiresAt: new Date(Date.now() + 60_000),
            },
          );
          releaseFence();
          return file;
        });
      await queue.resume();
      await fenceApplied;
      for (let i = 0; i < 100 && (await queue.getActiveCount()); i++)
        await new Promise((resolve) => setTimeout(resolve, 20));
      fault.mockRestore();
      expect(await state(fenced.id)).toMatchObject({
        status: 'processing',
        files: [],
      });
      await expect(
        workerStorage.stat!({ objectKey: abandonedKey }),
      ).rejects.toThrow();
      await db.manager.update(
        EsignExportJob,
        { publicId: fenced.id },
        { leaseExpiresAt: new Date(0) },
      );
      await worker.get(DocumentExportProcessor).maintain();
      expect(await waitFor(fenced.id, 'completed')).toMatchObject({
        expectedCount: 2,
      });

      // 快照以來源 metadata 的 SHA-256 驗證實體 bytes，不能發布半包或允許盲目重試。
      await queue.pause();
      await freshDocument();
      const damaged = apiData<{ id: string }>(await make(other).expect(202));
      await writeFile(
        join(process.env.ESIGN_STORAGE_ROOT!, stored.objectKey),
        Buffer.from('%PDF tampered source'),
      );
      await queue.resume();
      expect(await waitFor(damaged.id, 'failed')).toMatchObject({
        failureCode: 'ESIGN_INTEGRITY_FAILED',
        files: [],
      });
      await request(ctx.server)
        .post(`/api/esign/documents/${id}/exports/${damaged.id}/retries`)
        .set('Cookie', other)
        .set('Origin', origin)
        .expect(409);
    } finally {
      await ctx.app.get<Queue>(getQueueToken(ESIGN_EXPORT_QUEUE)).resume();
      await worker.close();
    }
  });

  it('多份歷史固定最新曾成功工作，缺檔或缺完成時間時不能退回較舊產物', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const documentId = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', cookie)
        .set('Origin', origin)
        .field('title', '固定歷史工作')
        .attach('file', Buffer.from(await pdf.save()), {
          filename: 'fixed.pdf',
          contentType: 'application/pdf',
        })
        .expect(201),
    ).id;
    const storage = ctx.app.get<PrivateFileStorage>(PRIVATE_FILE_STORAGE);
    const seed = async () => {
      const job = await db.manager.save(
        EsignExportJob,
        db.manager.create(EsignExportJob, {
          publicId: randomUUID(),
          documentId: Number(documentId),
          createdByUserId: Number(ownerId),
          exportType: 'signed_copies_zip',
          status: 'completed',
          scopeDescription: '合成固定成果',
          snapshotAt: new Date(),
          snapshotJson: [],
          snapshotSha256: 'a'.repeat(64),
          completedAt: new Date(),
          expiresAt: new Date(0),
          recordCount: 0,
        }),
      );
      const stored = await storage.store({
        directory: `exports/selection-${job.id}`,
        extension: 'zip',
        mimeType: 'application/zip',
        bytes: Buffer.from('synthetic zip'),
      });
      const file = await db.manager.save(
        EsignFileObject,
        db.manager.create(EsignFileObject, {
          ...stored,
          exportJobId: job.id,
          filePurpose: 'signed_copies_zip',
          archiveStatus: 'active',
        }),
      );
      return { job, file };
    };
    const older = await seed();
    const newest = await seed();
    const make = () =>
      request(ctx.server)
        .post(`/api/esign/documents/${documentId}/exports`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send({ type: 'signed_copies_zip' });
    expect(apiData(await make().expect(200))).toMatchObject({
      id: newest.job.publicId,
    });
    await storage.delete(newest.file);
    await make().expect(503);
    await request(ctx.server)
      .get(
        `/api/esign/documents/${documentId}/exports/${older.job.publicId}/files/${older.file.id}`,
      )
      .set('Cookie', cookie)
      .expect(200);
    await db.manager.update(
      EsignExportJob,
      { id: newest.job.id },
      { completedAt: null },
    );
    await make().expect(503);
    await db.manager.update(
      EsignExportJob,
      { id: newest.job.id },
      { status: 'expired', completedAt: new Date() },
    );
    await make().expect(503);
    const history = apiData<{ total: number }>(
      await request(ctx.server)
        .get(`/api/esign/history/export?type=zip&documentId=${documentId}`)
        .set('Cookie', cookie)
        .expect(200),
    );
    expect(history.total).toBe(2);
  });

  it('兩個 worker 仍只有一個匯出，慢目的端不會預先打開全部小副本', async () => {
    const storage = ctx.app.get<PrivateFileStorage>(PRIVATE_FILE_STORAGE);
    const queue = ctx.app.get<Queue>(getQueueToken(ESIGN_EXPORT_QUEUE));
    await queue.pause();
    const workers = await Promise.all([
      createSyntheticWorker(ctx),
      createSyntheticWorker(ctx),
    ]);
    let active = 0;
    let peak = 0;
    let beforeConsumption = 0;
    let peakReadAhead = 0;
    let consuming = false;
    const patches = workers.map((worker) => {
      const adapter = worker.get<PrivateFileStorage>(PRIVATE_FILE_STORAGE);
      const originalStore = adapter.storeStream!.bind(adapter);
      const originalRead = adapter.openReadStream.bind(adapter);
      const store = jest
        .spyOn(adapter, 'storeStream')
        .mockImplementation(async (input) => {
          active += 1;
          peak = Math.max(peak, active);
          consuming = false;
          beforeConsumption = 0;
          try {
            await new Promise((resolve) => setTimeout(resolve, 200));
            consuming = true;
            return await originalStore(input);
          } finally {
            active -= 1;
          }
        });
      const read = jest
        .spyOn(adapter, 'openReadStream')
        .mockImplementation((reference, options) => {
          if (!consuming) {
            beforeConsumption += 1;
            peakReadAhead = Math.max(peakReadAhead, beforeConsumption);
          }
          return originalRead(reference, options);
        });
      return { store, read };
    });
    try {
      const jobIds: Array<{ documentId: string; id: string }> = [];
      for (let d = 0; d < 2; d++) {
        const pdf = await PDFDocument.create();
        pdf.addPage();
        const documentId = apiData<{ id: string }>(
          await request(ctx.server)
            .post('/api/esign/documents')
            .set('Cookie', cookie)
            .set('Origin', origin)
            .field('title', '雙 worker 測試')
            .attach('file', Buffer.from(await pdf.save()), {
              filename: 'test.pdf',
              contentType: 'application/pdf',
            })
            .expect(201),
        ).id;
        for (let i = 0; i < 64; i++) {
          const signer = await db.manager.save(
            EsignSigner,
            db.manager.create(EsignSigner, {
              publicId: randomUUID(),
              documentId: Number(documentId),
              signerType: 'email',
              email: `bounded-${i}@example.test`,
              nameSnapshot: `小副本 ${i}`,
              status: 'signed',
              signedAt: new Date(),
              completionStatus: 'ready',
              completionReadyAt: new Date(),
              sortOrder: i,
            }),
          );
          const record = await db.manager.save(
            EsignSignatureRecord,
            db.manager.create(EsignSignatureRecord, {
              signerId: signer.id,
              documentSha256: 'a'.repeat(64),
              signingPayloadSha256: 'b'.repeat(64),
              consentVersion: 'test',
              authenticationMethod: 'test',
              authenticationEventId: randomUUID(),
              signedAtUtc: new Date(),
            }),
          );
          const file = await storage.store({
            directory: `documents/bounded-${documentId}`,
            extension: 'pdf',
            mimeType: 'application/pdf',
            bytes: Buffer.alloc(8192, i),
          });
          await db.manager.save(
            EsignFileObject,
            db.manager.create(EsignFileObject, {
              ...file,
              signatureRecordId: record.id,
              filePurpose: 'completed_pdf',
              archiveStatus: 'active',
            }),
          );
        }
        jobIds.push(
          apiData(
            await request(ctx.server)
              .post(`/api/esign/documents/${documentId}/exports`)
              .set('Cookie', cookie)
              .set('Origin', origin)
              .send({ type: 'signed_copies_zip' })
              .expect(202),
          ),
        );
      }
      await queue.resume();
      for (const job of jobIds) {
        for (let i = 0; i < 200; i++) {
          const result = apiData<{ status: string; expectedCount: number }>(
            await request(ctx.server)
              .get(`/api/esign/documents/${job.documentId}/exports/${job.id}`)
              .set('Cookie', other)
              .expect(200),
          );
          if (result.status === 'completed') {
            expect(result.expectedCount).toBe(64);
            break;
          }
          if (result.status === 'failed' || i === 199)
            throw new Error('雙 worker 測試未完成');
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      expect(peak).toBe(1);
      expect(peakReadAhead).toBeLessThan(64);
    } finally {
      for (const patch of patches) {
        patch.store.mockRestore();
        patch.read.mockRestore();
      }
      await queue.resume();
      await Promise.all(workers.map((worker) => worker.close()));
    }
  });

  it('來源實體檔遺失不能發布半包，恢復同 bytes 後同快照重試成功', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const documentId = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', cookie)
        .set('Origin', origin)
        .field('title', '遺失來源復原')
        .attach('file', Buffer.from(await pdf.save()), {
          filename: 'missing.pdf',
          contentType: 'application/pdf',
        })
        .expect(201),
    ).id;
    const signer = await db.manager.save(
      EsignSigner,
      db.manager.create(EsignSigner, {
        publicId: randomUUID(),
        documentId: Number(documentId),
        signerType: 'email',
        email: 'missing@example.test',
        nameSnapshot: '合成來源',
        status: 'signed',
        signedAt: new Date(),
        completionStatus: 'ready',
        completionReadyAt: new Date(),
        sortOrder: 0,
      }),
    );
    const record = await db.manager.save(
      EsignSignatureRecord,
      db.manager.create(EsignSignatureRecord, {
        signerId: signer.id,
        documentSha256: 'a'.repeat(64),
        signingPayloadSha256: 'b'.repeat(64),
        consentVersion: 'test',
        authenticationMethod: 'test',
        authenticationEventId: randomUUID(),
        signedAtUtc: new Date(),
      }),
    );
    const storage = ctx.app.get<PrivateFileStorage>(PRIVATE_FILE_STORAGE),
      bytes = Buffer.from('%PDF missing source recovery');
    const stored = await storage.store({
      directory: `documents/missing-${documentId}`,
      extension: 'pdf',
      mimeType: 'application/pdf',
      bytes,
    });
    await db.manager.save(
      EsignFileObject,
      db.manager.create(EsignFileObject, {
        ...stored,
        signatureRecordId: record.id,
        filePurpose: 'completed_pdf',
        archiveStatus: 'active',
      }),
    );
    await rm(join(process.env.ESIGN_STORAGE_ROOT!, stored.objectKey));
    const job = apiData<{ id: string }>(
      await request(ctx.server)
        .post(`/api/esign/documents/${documentId}/exports`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send({ type: 'signed_copies_zip' })
        .expect(202),
    );
    const worker = await createSyntheticWorker(ctx);
    const waitFor = async (status: string) => {
      for (let i = 0; i < 100; i++) {
        const value = apiData<{
          status: string;
          failureCode: string;
          expectedCount: number;
          files: Array<{ downloadPath: string }>;
        }>(
          await request(ctx.server)
            .get(`/api/esign/documents/${documentId}/exports/${job.id}`)
            .set('Cookie', other)
            .expect(200),
        );
        if (value.status === status) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`未進入 ${status}`);
    };
    try {
      expect(await waitFor('failed')).toMatchObject({
        failureCode: 'ESIGN_EXPORT_UNAVAILABLE',
        expectedCount: 1,
        files: [],
      });
      await writeFile(
        join(process.env.ESIGN_STORAGE_ROOT!, stored.objectKey),
        bytes,
      );
      expect(
        apiData(
          await request(ctx.server)
            .post(
              `/api/esign/documents/${documentId}/exports/${job.id}/retries`,
            )
            .set('Cookie', other)
            .set('Origin', origin)
            .expect(202),
        ),
      ).toMatchObject({ id: job.id, expectedCount: 1 });
      const completed = await waitFor('completed');
      expect(completed.files).toHaveLength(1);
      await request(ctx.server)
        .get(completed.files[0].downloadPath)
        .set('Cookie', other)
        .set('Range', 'bytes=0-3')
        .expect(206);
    } finally {
      await worker.close();
    }
  });

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
import { syntheticStaffEmails } from './synthetic-staff-emails.helper';
