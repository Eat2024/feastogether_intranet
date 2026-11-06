import { EsignDocument } from '#app/features/esign/entities/esign-document.entity';
import { ExportJobRepository } from '#app/features/esign/repositories/export-job.repository';
import { FileObjectRepository } from '#app/features/esign/repositories/file-object.repository';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import { DocumentExportProcessor } from '#app/worker/esign/document-export.processor';
import { EsignExportJob } from '#app/features/esign/entities/esign-export-job.entity';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { ESIGN_EXPORT_QUEUE } from '#app/features/esign/esign-queue.constants';
import { Test } from '@nestjs/testing';
import { startTestS3, type TestS3 } from './s3-test.helper';
import {
  ListObjectVersionsCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  PutObjectCommand,
  PutBucketVersioningCommand,
  CreateMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { WorkerModule } from '#app/worker.module';
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
import { EligibleStaffService } from '#app/features/auth/services/eligible-staff.service';
import { apiData } from './api-response.helper';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

jest.setTimeout(30_000);

describe('Spec009 S3 匯出 API/worker', () => {
  let s3: TestS3;
  let ctx: SecurityE2eContext;
  let db: DataSource;
  let cookie: string;
  let other: string;
  let id: string;
  let ownerId: string;
  const origin = 'http://localhost:3000';
  beforeAll(async () => {
    s3 = await startTestS3();
    ctx = await createSecurityE2eApp((builder) =>
      builder
        .overrideProvider(PRIVATE_FILE_STORAGE)
        .useValue(s3.storage)
        .overrideProvider(EligibleStaffService)
        .useValue({
          lookupEligibleStaff: (empid: string) =>
            Promise.resolve({
              person_empid: empid,
              person_name: '草稿測試員工',
              person_status: 1,
              person_status_name: '正式',
              department_id: 'D009',
              department_name: '測試部',
              title: '測試員工',
            }),
        }),
    );
    db = ctx.app.get<DataSource>(MYSQL_MAIN);
    cookie = await login('EXPORT00901');
    other = await login('EXPORT00902');
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
    await s3?.close();
  });

  it('員工可跨建立人查找，但空文件不能匯出', async () => {
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
      bytes: Buffer.alloc(33 * 1024 * 1024, 0x61),
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
    const worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(PRIVATE_FILE_STORAGE)
      .useValue(s3.storage)
      .compile();
    await worker.init();
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
      const download = await request(ctx.server)
        .get(file.downloadPath)
        .set('Cookie', other)
        .set('Range', 'bytes=0-3')
        .expect(206);
      expect(download.headers['content-range']).toBe(`bytes 0-3/${file.size}`);
      expect(download.headers.etag).toBe(`"${file.sha256}"`);
      const reused = apiData<{ id: string }>(await make(other).expect(200));
      expect(reused.id).toBe(job.id);
      expect(file.size).toBeGreaterThan(33 * 1024 * 1024);
      await request(ctx.server).get(file.downloadPath).expect(401);
      await request(ctx.server)
        .get(file.downloadPath)
        .set('Cookie', other)
        .set('Range', `bytes=${file.size}-`)
        .expect(416);
      const versions = await s3.client.send(
        new ListObjectVersionsCommand({
          Bucket: s3.bucket,
          Prefix: 'exports/',
        }),
      );
      expect(versions.Versions).toHaveLength(1);
      expect(versions.Versions![0].Size).toBe(file.size);
      // 同 key、同長度覆寫仍必須依固定版本續傳原 ZIP，不可以尺寸檢查掩蓋替換。
      await s3.client.send(
        new PutObjectCommand({
          Bucket: s3.bucket,
          Key: versions.Versions![0].Key,
          Body: Buffer.alloc(file.size, 0x7a),
        }),
      );
      const pinnedDownload = await request(ctx.server)
        .get(file.downloadPath)
        .set('Cookie', other)
        .set('Range', 'bytes=0-3')
        .expect(206);
      expect(pinnedDownload.body).toEqual(download.body);
      expect(pinnedDownload.headers.etag).toBe(download.headers.etag);

      expect(
        (
          await s3.client.send(
            new ListMultipartUploadsCommand({ Bucket: s3.bucket }),
          )
        ).Uploads ?? [],
      ).toHaveLength(0);
    } finally {
      await worker.close();
    }
  });

  it('Spec030 只清除被取代 ZIP 的固定 S3 版本，刪後中斷可重入且新版可下載', async () => {
    const queue = ctx.app.get<Queue>(getQueueToken(ESIGN_EXPORT_QUEUE));
    await queue.pause();
    const processor = new DocumentExportProcessor(
      ctx.app.get(MysqlService),
      ctx.app.get(ExportJobRepository),
      ctx.app.get(FileObjectRepository),
      s3.storage,
      queue,
      ctx.app.get(AppLoggerService),
    );
    try {
      const document = await db.manager.save(
        EsignDocument,
        db.manager.create(EsignDocument, {
          docNumber: randomUUID(),
          title: '合成 S3 新版取代',
          status: 'active',
          createdByUserId: Number(ownerId),
          createdByDepartmentCode: 'D009',
          signStartAt: new Date(Date.now() - 60000),
          signEndAt: new Date(Date.now() + 86400000),
        }),
      );
      async function signed(order: number) {
        const signer = await db.manager.save(
          EsignSigner,
          db.manager.create(EsignSigner, {
            publicId: randomUUID(),
            documentId: document.id,
            signerType: 'email',
            email: `s3-${order}@example.test`,
            nameSnapshot: `合成簽署人${order}`,
            status: 'signed',
            signedAt: new Date(),
            completionStatus: 'ready',
            completionReadyAt: new Date(),
            sortOrder: order,
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
        const pdf = await PDFDocument.create();
        pdf.addPage().drawText(`Synthetic signed copy ${order}`);
        const stored = await s3.storage.store({
          directory: `documents/s3-refresh-${document.id}`,
          extension: 'pdf',
          mimeType: 'application/pdf',
          bytes: Buffer.from(await pdf.save()),
        });
        return db.manager.save(
          EsignFileObject,
          db.manager.create(EsignFileObject, {
            ...stored,
            signatureRecordId: record.id,
            filePurpose: 'completed_pdf',
            archiveStatus: 'active',
          }),
        );
      }
      async function generate() {
        const accepted = apiData<{ id: string }>(
          await request(ctx.server)
            .post(`/api/esign/documents/${document.id}/exports`)
            .set('Cookie', cookie)
            .set('Origin', origin)
            .send({ type: 'signed_copies_zip' })
            .expect(202),
        );
        const job = await db.manager.findOneByOrFail(EsignExportJob, {
          publicId: accepted.id,
        });
        await processor.run(job.id);
        return apiData<{
          id: string;
          status: string;
          files: Array<{ id: string; downloadPath: string }>;
        }>(
          await request(ctx.server)
            .get(`/api/esign/documents/${document.id}/exports/${accepted.id}`)
            .set('Cookie', cookie)
            .expect(200),
        );
      }
      const personal = await signed(1);
      const old = await generate();
      const original = await db.manager.findOneByOrFail(EsignFileObject, {
        id: Number(old.files[0].id),
      });
      expect(original.objectVersion).toBeTruthy();
      const unrelatedVersion = await s3.client.send(
        new PutObjectCommand({
          Bucket: s3.bucket,
          Key: original.objectKey,
          Body: Buffer.from('synthetic unrelated version'),
        }),
      );
      await signed(2);
      const remove = s3.storage.delete.bind(s3.storage);
      const interrupted = jest
        .spyOn(s3.storage, 'delete')
        .mockImplementation(async (reference) => {
          await remove(reference);
          if (reference.objectKey === original.objectKey)
            throw new Error('合成 S3 刪後回寫前中斷');
        });
      let next: Awaited<ReturnType<typeof generate>>;
      try {
        next = await generate();
      } finally {
        interrupted.mockRestore();
      }
      expect(next.status).toBe('completed');
      await request(ctx.server)
        .get(next.files[0].downloadPath)
        .set('Cookie', cookie)
        .expect(200);
      await request(ctx.server)
        .get(old.files[0].downloadPath)
        .set('Cookie', cookie)
        .expect(409);
      expect(
        (await db.manager.findOneByOrFail(EsignFileObject, { id: original.id }))
          .archiveStatus,
      ).toBe('delete_pending');
      await expect(
        s3.client.send(
          new HeadObjectCommand({
            Bucket: s3.bucket,
            Key: original.objectKey,
            VersionId: original.objectVersion!,
          }),
        ),
      ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
      const pending = await db.manager.findOneByOrFail(EsignExportJob, {
        publicId: old.id,
      });
      await processor.maintain(pending.nextAttemptAt!);
      await processor.maintain(
        new Date(pending.nextAttemptAt!.getTime() + 60000),
      );
      expect(
        (await db.manager.findOneByOrFail(EsignFileObject, { id: original.id }))
          .archiveStatus,
      ).toBe('deleted');
      const versions = await s3.client.send(
        new ListObjectVersionsCommand({
          Bucket: s3.bucket,
          Prefix: original.objectKey,
        }),
      );
      expect(
        versions.Versions?.some((v) => v.VersionId === original.objectVersion),
      ).toBe(false);
      expect(versions.Versions?.map((v) => v.VersionId)).toContain(
        unrelatedVersion.VersionId,
      );
      expect(versions.DeleteMarkers ?? []).toHaveLength(0);
      expect(await s3.storage.stat(personal)).toMatchObject({
        fileSize: Number(personal.fileSize),
      });
      await request(ctx.server)
        .get(next.files[0].downloadPath)
        .set('Cookie', cookie)
        .set('Range', 'bytes=0-3')
        .expect(206);
    } finally {
      await queue.resume();
    }
  });

  it('bucket 暫停版本控制時 worker 不發布 ZIP，恢復後可重試原快照', async () => {
    // 永久 ZIP 不靠過期重新產生；此故障案例使用另一份合成文件。
    const oldId = id;
    const pdf = await PDFDocument.create();
    pdf.addPage();
    id = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', cookie)
        .set('Origin', origin)
        .field('title', 'S3 版本控制故障案例')
        .attach('file', Buffer.from(await pdf.save()), {
          filename: 'draft.pdf',
          contentType: 'application/pdf',
        })
        .expect(201),
    ).id;
    await db.manager.update(
      EsignSigner,
      { documentId: Number(oldId) },
      { documentId: Number(id) },
    );
    await s3.client.send(
      new PutBucketVersioningCommand({
        Bucket: s3.bucket,
        VersioningConfiguration: { Status: 'Suspended' },
      }),
    );
    const accepted = apiData<{ id: string }>(
      await request(ctx.server)
        .post(`/api/esign/documents/${id}/exports`)
        .set('Cookie', other)
        .set('Origin', origin)
        .send({ type: 'signed_copies_zip' })
        .expect(202),
    );
    const worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(PRIVATE_FILE_STORAGE)
      .useValue(s3.storage)
      .compile();
    await worker.init();
    const read = async () =>
      apiData<{ status: string; files: unknown[] }>(
        await request(ctx.server)
          .get(`/api/esign/documents/${id}/exports/${accepted.id}`)
          .set('Cookie', other)
          .expect(200),
      );
    try {
      let result = await read();
      for (let i = 0; i < 100 && result.status !== 'failed'; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        result = await read();
      }
      expect(result.status).toBe('failed');
      expect(result.files).toHaveLength(0);
      const versions = await s3.client.send(
        new ListObjectVersionsCommand({
          Bucket: s3.bucket,
          Prefix: 'exports/',
        }),
      );
      expect(
        (versions.Versions ?? []).every(
          (v) => v.VersionId && v.VersionId !== 'null',
        ),
      ).toBe(true);
      expect(
        (
          await s3.client.send(
            new ListMultipartUploadsCommand({ Bucket: s3.bucket }),
          )
        ).Uploads ?? [],
      ).toHaveLength(0);
      await s3.client.send(
        new PutBucketVersioningCommand({
          Bucket: s3.bucket,
          VersioningConfiguration: { Status: 'Enabled' },
        }),
      );
      await request(ctx.server)
        .post(`/api/esign/documents/${id}/exports/${accepted.id}/retries`)
        .set('Cookie', other)
        .set('Origin', origin)
        .expect(202);
      for (let i = 0; i < 100; i++) {
        result = await read();
        if (result.status === 'completed') break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(result.status).toBe('completed');
      expect(result.files).toHaveLength(1);
    } finally {
      await s3.client.send(
        new PutBucketVersioningCommand({
          Bucket: s3.bucket,
          VersioningConfiguration: { Status: 'Enabled' },
        }),
      );
      await worker.close();
    }
  });

  it('維護清理 failed/stale staging，保留有效租約 generation 與來源', async () => {
    const queue = ctx.app.get<Queue>(getQueueToken(ESIGN_EXPORT_QUEUE));
    await queue.pause();
    const keys = [
      'exports/cleanup/a-active.zip',
      'exports/cleanup/z-failed.zip',
      'exports/cleanup/zz-stale.zip',
    ];
    const uploads: string[] = [];
    for (let i = 0; i < keys.length; i++) {
      await s3.client.send(
        new PutObjectCommand({
          Bucket: s3.bucket,
          Key: keys[i],
          Body: 'staging',
        }),
      );
      const upload = await s3.client.send(
        new CreateMultipartUploadCommand({ Bucket: s3.bucket, Key: keys[i] }),
      );
      uploads.push(upload.UploadId!);
      const generation = randomUUID();
      await db.manager.save(
        EsignExportJob,
        db.manager.create(EsignExportJob, {
          publicId: randomUUID(),
          documentId: Number(id),
          createdByUserId: Number(ownerId),
          exportType: 'signed_copies_zip',
          scopeDescription: '合成 staging 清理',
          snapshotJson: [],
          status: i !== 1 ? 'processing' : 'failed',
          leaseToken: i === 0 ? generation : i === 2 ? randomUUID() : null,
          leaseExpiresAt: i !== 1 ? new Date(Date.now() + 48 * 3600_000) : null,
          stagingJson: {
            generation,
            objectKey: keys[i],
            uploadId: upload.UploadId,
          },
        }),
      );
    }
    const worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(PRIVATE_FILE_STORAGE)
      .useValue(s3.storage)
      .compile();
    await worker.init();
    try {
      await worker
        .get(DocumentExportProcessor)
        .maintain(new Date(Date.now() + 25 * 3600_000));
      const versions = await s3.client.send(
        new ListObjectVersionsCommand({
          Bucket: s3.bucket,
          Prefix: 'exports/cleanup/',
        }),
      );
      expect(versions.Versions?.map((v) => v.Key)).toEqual([keys[0]]);
      expect(
        (
          await s3.client.send(
            new ListMultipartUploadsCommand({
              Bucket: s3.bucket,
              Prefix: 'exports/cleanup/',
            }),
          )
        ).Uploads?.map((v) => v.UploadId),
      ).toEqual([uploads[0]]);
      const sources = await s3.client.send(
        new ListObjectVersionsCommand({
          Bucket: s3.bucket,
          Prefix: 'documents/',
        }),
      );
      expect(sources.Versions?.length).toBeGreaterThan(0);
    } finally {
      await worker.close();
      await queue.resume();
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
