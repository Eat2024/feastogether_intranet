import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { DataSource, In } from 'typeorm';
import request from 'supertest';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PDFDocument } from 'pdf-lib';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import { AuthService } from '#app/features/auth/services/auth.service';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import { ESIGN_EXPORT_QUEUE } from '#app/features/esign/esign-queue.constants';
import { EsignSigner } from '#app/features/esign/entities/esign-signer.entity';
import { EsignSignatureRecord } from '#app/features/esign/entities/esign-signature-record.entity';
import { EsignExportService } from '#app/features/esign/services/esign-export.service';
import { ExportJobRepository } from '#app/features/esign/repositories/export-job.repository';
import { FileObjectRepository } from '#app/features/esign/repositories/file-object.repository';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { PRIVATE_FILE_STORAGE } from '#app/infrastructure/file-storage/private-file-storage.port';
import { DocumentExportProcessor } from '#app/worker/esign/document-export.processor';
import { apiData } from './api-response.helper';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';
import { EsignDocument } from '#app/features/esign/entities/esign-document.entity';
import { EsignExportJob } from '#app/features/esign/entities/esign-export-job.entity';
import { EsignFileObject } from '#app/features/esign/entities/esign-file-object.entity';
import { User } from '#app/features/users/entities/user.entity';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';
import { LocalPrivateFileStorage } from '#app/infrastructure/file-storage/local-private-file-storage.service';
import {
  inspectExportRetention,
  applyExportRetention,
  parseRetentionManifest,
} from '../scripts/normalize-export-retention';

describe('ZIP 保存政策轉換工具', () => {
  let db: DataSource;
  let root: string;
  let storage: LocalPrivateFileStorage;
  let document: EsignDocument;
  let user: User;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'esign-retention-'));
    storage = new LocalPrivateFileStorage(root);
    db = await new DataSource(buildMysqlOptions()).initialize();
    user = await db.manager.save(
      User,
      db.manager.create(User, {
        empid: `retention-${randomUUID().slice(0, 8)}`,
        name: '合成建立人',
      }),
    );
    document = await db.manager.save(
      EsignDocument,
      db.manager.create(EsignDocument, {
        docNumber: randomUUID(),
        title: '合成文件',
        createdByUserId: user.id,
        status: 'draft',
      }),
    );
  });
  afterAll(async () => {
    if (db) {
      const jobs = await db.manager.findBy(EsignExportJob, {
        documentId: document.id,
      });
      for (const job of jobs)
        await db.manager.delete(EsignFileObject, { exportJobId: job.id });
      await db.manager.delete(EsignExportJob, { documentId: document.id });
      await db.manager.delete(EsignDocument, document.id);
      await db.manager.delete(User, user.id);
      await db.destroy();
    }
    if (root) await rm(root, { recursive: true, force: true });
  });
  async function fixture(status: 'completed' | 'expired' = 'expired') {
    const job = await db.manager.save(
      EsignExportJob,
      db.manager.create(EsignExportJob, {
        publicId: randomUUID(),
        documentId: document.id,
        createdByUserId: user.id,
        exportType: 'signed_copies_zip',
        snapshotAt: new Date(),
        snapshotJson: [],
        snapshotSha256: 'b'.repeat(64),
        scopeDescription: '合成範圍',
        status,
        completedAt: new Date('2026-01-01'),
        expiresAt: new Date('2026-01-08'),
      }),
    );
    const stored = await storage.storeStream({
      directory: 'exports',
      extension: 'zip',
      mimeType: 'application/zip',
      stream: Readable.from([Buffer.from('synthetic original zip')]),
    });
    const file = await db.manager.save(
      EsignFileObject,
      db.manager.create(EsignFileObject, {
        ...stored,
        exportJobId: job.id,
        filePurpose: 'signed_copies_zip',
        archiveStatus: status === 'expired' ? 'expired' : 'active',
      }),
    );
    return { job, file };
  }
  it('預設盤點驗證原 ZIP，但不恢復到期狀態或暴露物件位置', async () => {
    const job = await db.manager.save(
      EsignExportJob,
      db.manager.create(EsignExportJob, {
        publicId: randomUUID(),
        documentId: document.id,
        createdByUserId: user.id,
        exportType: 'signed_copies_zip',
        snapshotAt: new Date(),
        snapshotJson: [],
        snapshotSha256: 'a'.repeat(64),
        scopeDescription: '合成範圍',
        status: 'expired',
        completedAt: new Date('2026-01-01'),
        expiresAt: new Date('2026-01-08'),
      }),
    );
    const stored = await storage.storeStream({
      directory: 'exports',
      extension: 'zip',
      mimeType: 'application/zip',
      stream: Readable.from([Buffer.from('synthetic zip')]),
    });
    await db.manager.save(
      EsignFileObject,
      db.manager.create(EsignFileObject, {
        ...stored,
        exportJobId: job.id,
        filePurpose: 'signed_copies_zip',
        archiveStatus: 'expired',
      }),
    );
    const report = await inspectExportRetention(db, storage);
    expect(report.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          jobId: String(job.id),
          decision: 'ready',
          fixed: true,
        }),
      ]),
    );
    expect(JSON.stringify(report)).not.toContain(stored.objectKey);
    expect(
      (await db.manager.findOneByOrFail(EsignExportJob, { id: job.id })).status,
    ).toBe('expired');
  });
  it('核對後恢復仍存在的原產物，保留原紀錄並可重跑', async () => {
    const { job, file } = await fixture();
    const before = await db.manager.findOneByOrFail(EsignExportJob, {
      id: job.id,
    });
    const manifest = await inspectExportRetention(db, storage);
    manifest.entries = manifest.entries.filter(
      (row) => row.jobId === String(job.id),
    );
    expect(await applyExportRetention(db, storage, manifest)).toEqual([
      { jobId: String(job.id), result: 'applied' },
    ]);
    const after = await db.manager.findOneByOrFail(EsignExportJob, {
      id: job.id,
    });
    expect(after).toMatchObject({
      status: 'completed',
      expiresAt: null,
      snapshotJson: before.snapshotJson,
      snapshotSha256: before.snapshotSha256,
      createdAt: before.createdAt,
      completedAt: before.completedAt,
    });
    expect(
      (await db.manager.findOneByOrFail(EsignFileObject, { id: file.id }))
        .archiveStatus,
    ).toBe('active');
    expect(await applyExportRetention(db, storage, manifest)).toEqual([
      { jobId: String(job.id), result: 'unchanged' },
    ]);
    expect(
      (await db.manager.findOneByOrFail(EsignExportJob, { id: job.id }))
        .updatedAt,
    ).toEqual(after.updatedAt);
    expect(
      (await inspectExportRetention(db, storage)).entries.find(
        (row) => row.jobId === String(job.id),
      )?.decision,
    ).toBe('unchanged');
  });
  it('較新的已清除ZIP仍是固定工作，不改選可用舊檔或重建', async () => {
    const older = await fixture('completed');
    const newer = await fixture();
    await storage.delete(newer.file);
    const manifest = await inspectExportRetention(db, storage);
    expect(
      manifest.entries.find((row) => row.jobId === String(newer.job.id)),
    ).toMatchObject({ fixed: true, decision: 'unavailable' });
    expect(
      manifest.entries.find((row) => row.jobId === String(older.job.id)),
    ).toMatchObject({ fixed: false, decision: 'ready' });
    manifest.entries = manifest.entries.filter(
      (row) => row.jobId === String(newer.job.id),
    );
    expect(await applyExportRetention(db, storage, manifest)).toEqual([
      { jobId: String(newer.job.id), result: 'unavailable' },
    ]);
    expect(
      (await db.manager.findOneByOrFail(EsignExportJob, { id: newer.job.id }))
        .status,
    ).toBe('expired');
  });
  it('較新的異常到期工作缺少完成時間時，仍固定且不可用，不改選舊檔', async () => {
    const older = await fixture('completed');
    const newer = await fixture();
    newer.job.completedAt = null;
    await db.manager.save(newer.job);
    const manifest = await inspectExportRetention(db, storage);
    expect(
      manifest.entries.find((row) => row.jobId === String(newer.job.id)),
    ).toMatchObject({ fixed: true, decision: 'unavailable' });
    expect(
      manifest.entries.find((row) => row.jobId === String(older.job.id)),
    ).toMatchObject({ fixed: false, decision: 'ready' });
    manifest.entries = manifest.entries.filter(
      (row) => row.jobId === String(newer.job.id),
    );
    expect(await applyExportRetention(db, storage, manifest)).toEqual([
      { jobId: String(newer.job.id), result: 'unavailable' },
    ]);
    expect(
      (await db.manager.findOneByOrFail(EsignExportJob, { id: newer.job.id }))
        .completedAt,
    ).toBeNull();
  });
  it('盤點後原檔被移除時拒絕恢復', async () => {
    const { job, file } = await fixture();
    const manifest = await inspectExportRetention(db, storage);
    manifest.entries = manifest.entries.filter(
      (row) => row.jobId === String(job.id),
    );
    await storage.delete(file);
    expect(await applyExportRetention(db, storage, manifest)).toEqual([
      { jobId: String(job.id), result: 'unavailable' },
    ]);
  });
  it('同大小但雜湊錯誤的檔案不可恢復', async () => {
    const { job, file } = await fixture();
    file.sha256 = '0'.repeat(64);
    await db.manager.save(file);
    expect(
      (await inspectExportRetention(db, storage)).entries.find(
        (row) => row.jobId === String(job.id),
      )?.decision,
    ).toBe('unavailable');
  });
  it('政策前值或產物指紋已變更時不套用過時清單', async () => {
    const { job } = await fixture();
    const manifest = await inspectExportRetention(db, storage);
    manifest.entries = manifest.entries.filter(
      (row) => row.jobId === String(job.id),
    );
    job.expiresAt = new Date('2026-01-09');
    await db.manager.save(job);
    expect(await applyExportRetention(db, storage, manifest)).toEqual([
      { jobId: String(job.id), result: 'changed' },
    ]);
  });
  it('拒絕錯誤目標、重複ID及不完整清單', async () => {
    const { job } = await fixture();
    const manifest = await inspectExportRetention(db, storage);
    manifest.entries = manifest.entries.filter(
      (row) => row.jobId === String(job.id),
    );
    await expect(
      applyExportRetention(db, storage, {
        ...manifest,
        target: '0'.repeat(64),
      }),
    ).rejects.toThrow('不屬於目前資料庫');
    expect(() =>
      parseRetentionManifest({
        ...manifest,
        entries: [...manifest.entries, ...manifest.entries],
      }),
    ).toThrow('格式不正確');
    expect(() =>
      parseRetentionManifest({
        version: 1,
        entries: [{ jobId: String(job.id) }],
      }),
    ).toThrow('格式不正確');
  });
});

describe('Spec030 ZIP 取代與補清理', () => {
  let ctx: SecurityE2eContext;
  let db: DataSource;
  let storage: LocalPrivateFileStorage;
  let root: string;
  let queue: Queue;
  let processor: DocumentExportProcessor;
  let cookie: string;
  let user: User;
  const origin = 'http://localhost:3000';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'esign-replacement-'));
    storage = new LocalPrivateFileStorage(root);
    ctx = await createSecurityE2eApp((builder) =>
      builder.overrideProvider(PRIVATE_FILE_STORAGE).useValue(storage),
    );
    db = ctx.app.get<DataSource>(MYSQL_MAIN);
    queue = ctx.app.get<Queue>(getQueueToken(ESIGN_EXPORT_QUEUE));
    await queue.pause();
    user = await db.manager.save(
      User,
      db.manager.create(User, {
        empid: `replace-${randomUUID().slice(0, 8)}`,
        name: '合成匯出員工',
        departmentCode: 'D030',
      }),
    );
    const session = await ctx.app.get(AuthService).issueSession(user.id);
    cookie = `${AUTH_COOKIE_NAME}=${session.token}`;
    processor = new DocumentExportProcessor(
      ctx.app.get(MysqlService),
      ctx.app.get(ExportJobRepository),
      ctx.app.get(FileObjectRepository),
      storage,
      queue,
      ctx.app.get(AppLoggerService),
    );
  });
  afterAll(async () => {
    if (queue) await queue.resume();
    if (ctx) await closeSecurityE2eApp(ctx);
    if (root) await rm(root, { recursive: true, force: true });
  });
  async function documentFixture() {
    return db.manager.save(
      EsignDocument,
      db.manager.create(EsignDocument, {
        docNumber: randomUUID(),
        title: '合成新版取代驗證',
        status: 'active',
        createdByUserId: user.id,
        createdByDepartmentCode: 'D030',
        signStartAt: new Date(Date.now() - 60000),
        signEndAt: new Date(Date.now() + 86400000),
      }),
    );
  }
  async function addSigned(document: EsignDocument, order: number) {
    const signer = await db.manager.save(
      EsignSigner,
      db.manager.create(EsignSigner, {
        publicId: randomUUID(),
        documentId: document.id,
        signerType: 'email',
        email: `replace-${order}@example.test`,
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
    pdf.addPage().drawText(`Signed copy ${order}`);
    const stored = await storage.store({
      directory: `documents/replacement-${document.id}`,
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
  async function generate(document: EsignDocument) {
    const accepted = await ctx.app
      .get(EsignExportService)
      .request(document.id, user.id);
    const job = await db.manager.findOneByOrFail(EsignExportJob, {
      publicId: accepted.id,
    });
    await processor.run(job.id);
    return apiData<{
      id: string;
      status: string;
      expectedCount: number;
      files: Array<{ id: string; downloadPath: string }>;
    }>(
      await request(ctx.server)
        .get(`/api/esign/documents/${document.id}/exports/${accepted.id}`)
        .set('Cookie', cookie)
        .expect(200),
    );
  }
  it('新版成功後拒絕舊下載並清除舊 ZIP，歷史與個人副本仍保留', async () => {
    const document = await documentFixture();
    const source = await addSigned(document, 1);
    const originalPdf = await storage.store({
      directory: `documents/replacement-${document.id}`,
      extension: 'pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from('synthetic original document'),
    });
    await db.manager.save(
      EsignFileObject,
      db.manager.create(EsignFileObject, {
        ...originalPdf,
        documentId: document.id,
        filePurpose: 'original_pdf',
        archiveStatus: 'active',
      }),
    );
    const otherDocument = await documentFixture();
    await addSigned(otherDocument, 1);
    const otherZip = await generate(otherDocument);
    const old = await generate(document);
    expect(old.status).toBe('completed');
    const original = await db.manager.findOneByOrFail(EsignFileObject, {
      id: Number(old.files[0].id),
    });
    await request(ctx.server)
      .get(old.files[0].downloadPath)
      .set('Cookie', cookie)
      .expect(200);
    await addSigned(document, 2);
    const next = await generate(document);
    expect(next).toMatchObject({ status: 'completed', expectedCount: 2 });
    const oldView = apiData(
      await request(ctx.server)
        .get(`/api/esign/documents/${document.id}/exports/${old.id}`)
        .set('Cookie', cookie)
        .expect(200),
    );
    expect(oldView).toMatchObject({ status: 'superseded', files: [] });
    await request(ctx.server)
      .get(old.files[0].downloadPath)
      .set('Cookie', cookie)
      .expect(409);
    await request(ctx.server)
      .get(old.files[0].downloadPath)
      .set('Cookie', cookie)
      .set('Range', 'bytes=0-3')
      .expect(409);
    await request(ctx.server)
      .post(`/api/esign/documents/${document.id}/export-downloads`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({ type: 'zip', exportId: old.id, fileId: old.files[0].id })
      .expect(409);
    await request(ctx.server)
      .get(next.files[0].downloadPath)
      .set('Cookie', cookie)
      .expect(200);
    await expect(storage.stat(original)).rejects.toThrow();
    expect(await storage.stat(originalPdf)).toMatchObject({
      fileSize: originalPdf.fileSize,
    });
    await request(ctx.server)
      .get(otherZip.files[0].downloadPath)
      .set('Cookie', cookie)
      .expect(200);
    expect(await storage.stat(source)).toMatchObject({
      fileSize: Number(source.fileSize),
    });
    const history = apiData<{
      items: Array<{ id: string; status: string; files: unknown[] }>;
    }>(
      await request(ctx.server)
        .get(`/api/esign/history/export?type=zip&documentId=${document.id}`)
        .set('Cookie', cookie)
        .expect(200),
    );
    expect(history.items.find((item) => item.id === old.id)).toMatchObject({
      status: 'superseded',
      files: [],
    });
  });
  it('大型歷史快照不因資料庫排序失敗而阻止發布及清理', async () => {
    const document = await documentFixture();
    await addSigned(document, 1);
    const old = await generate(document);
    const previous = await db.manager.findOneByOrFail(EsignExportJob, {
      publicId: old.id,
    });
    // 單獨放大歷史 metadata 的真 DB 回歸；實際 6000 PDF 完整性另由容量 harness 驗證。
    const entry = previous.snapshotJson![0];
    try {
      await db.manager.update(
        EsignExportJob,
        { id: previous.id },
        {
          snapshotJson: Array.from({ length: 6000 }, (_, i) => ({
            ...entry,
            recordId: i === 0 ? entry.recordId : 800000000 + i,
            signerPublicId: randomUUID(),
          })),
        },
      );
      await addSigned(document, 2);
      const next = await generate(document);
      expect(next.status).toBe('completed');
      const file = await db.manager.findOneByOrFail(EsignFileObject, {
        id: Number(old.files[0].id),
      });
      expect(file.archiveStatus).toBe('deleted');
      await expect(storage.stat(file)).rejects.toThrow();
      expect(
        (await db.manager.findOneByOrFail(EsignExportJob, { id: previous.id }))
          .status,
      ).toBe('superseded');
    } finally {
      await db.manager.update(
        EsignExportJob,
        { id: previous.id },
        { snapshotJson: previous.snapshotJson },
      );
    }
  });
  it('發布前 storage 驗證失敗保留舊成果，新工作可明確重試', async () => {
    const document = await documentFixture();
    await addSigned(document, 1);
    const old = await generate(document);
    await addSigned(document, 2);
    const stat = storage.stat.bind(storage);
    const failure = jest
      .spyOn(storage, 'stat')
      .mockImplementation(async (reference) => {
        if (reference.objectKey.startsWith('exports/'))
          throw new Error('合成發布前不可讀');
        return stat(reference);
      });
    let next: Awaited<ReturnType<typeof generate>>;
    try {
      next = await generate(document);
    } finally {
      failure.mockRestore();
    }
    expect(next.status).toBe('failed');
    await request(ctx.server)
      .get(old.files[0].downloadPath)
      .set('Cookie', cookie)
      .expect(200);
    expect(
      (await db.manager.findOneByOrFail(EsignExportJob, { publicId: old.id }))
        .status,
    ).toBe('completed');
  });
  it.each([false, true])(
    '刪檔%s中斷不污染新版，60 秒後可重入補清理',
    async (afterDelete) => {
      const document = await documentFixture();
      const personal = await addSigned(document, 1);
      const old = await generate(document);
      const original = await db.manager.findOneByOrFail(EsignFileObject, {
        id: Number(old.files[0].id),
      });
      await addSigned(document, 2);
      const remove = storage.delete.bind(storage);
      const failure = jest
        .spyOn(storage, 'delete')
        .mockImplementation(async (reference) => {
          if (reference.objectKey === original.objectKey) {
            if (afterDelete) await remove(reference);
            throw new Error('合成刪除中斷');
          }
          return remove(reference);
        });
      const started = Date.now();
      let next: Awaited<ReturnType<typeof generate>>;
      try {
        next = await generate(document);
      } finally {
        failure.mockRestore();
      }
      expect(next.status).toBe('completed');
      const pending = await db.manager.findOneByOrFail(EsignExportJob, {
        publicId: old.id,
      });
      expect(pending.status).toBe('superseded');
      expect(pending.nextAttemptAt!.getTime()).toBeGreaterThanOrEqual(
        started + 60_000,
      );
      expect(
        (await db.manager.findOneByOrFail(EsignFileObject, { id: original.id }))
          .archiveStatus,
      ).toBe('delete_pending');
      await request(ctx.server)
        .get(next.files[0].downloadPath)
        .set('Cookie', cookie)
        .expect(200);
      await request(ctx.server)
        .get(old.files[0].downloadPath)
        .set('Cookie', cookie)
        .expect(409);
      if (afterDelete) await expect(storage.stat(original)).rejects.toThrow();
      else
        expect(await storage.stat(original)).toMatchObject({
          fileSize: Number(original.fileSize),
        });
      await processor.maintain(new Date(pending.nextAttemptAt!.getTime() - 1));
      expect(
        (await db.manager.findOneByOrFail(EsignFileObject, { id: original.id }))
          .archiveStatus,
      ).toBe('delete_pending');
      await processor.maintain(pending.nextAttemptAt!);
      await processor.maintain(
        new Date(pending.nextAttemptAt!.getTime() + 60_000),
      );
      expect(
        (await db.manager.findOneByOrFail(EsignFileObject, { id: original.id }))
          .archiveStatus,
      ).toBe('deleted');
      await expect(storage.stat(original)).rejects.toThrow();
      expect(await storage.stat(personal)).toMatchObject({
        fileSize: Number(personal.fileSize),
      });
      await request(ctx.server)
        .get(next.files[0].downloadPath)
        .set('Cookie', cookie)
        .expect(200);
    },
  );
  it('活躍 staging 參照先延後清理，參照釋放後才刪除', async () => {
    const document = await documentFixture();
    await addSigned(document, 1);
    const old = await generate(document);
    const original = await db.manager.findOneByOrFail(EsignFileObject, {
      id: Number(old.files[0].id),
    });
    const otherDocument = await documentFixture();
    const generation = randomUUID();
    const reference = await db.manager.save(
      EsignExportJob,
      db.manager.create(EsignExportJob, {
        publicId: randomUUID(),
        documentId: otherDocument.id,
        createdByUserId: user.id,
        exportType: 'signed_copies_zip',
        snapshotJson: [],
        snapshotAt: new Date(),
        snapshotSha256: 'c'.repeat(64),
        scopeDescription: '合成參照',
        status: 'processing',
        leaseToken: generation,
        leaseExpiresAt: new Date(Date.now() + 300_000),
        stagingJson: {
          generation,
          objectKey: original.objectKey,
          objectVersion: original.objectVersion ?? undefined,
        },
      }),
    );
    await addSigned(document, 2);
    const next = await generate(document);
    expect(next.status).toBe('completed');
    expect(await storage.stat(original)).toMatchObject({
      fileSize: Number(original.fileSize),
    });
    const pending = await db.manager.findOneByOrFail(EsignExportJob, {
      publicId: old.id,
    });
    expect(pending.nextAttemptAt).not.toBeNull();
    reference.status = 'failed';
    reference.stagingJson = null;
    reference.leaseToken = null;
    reference.leaseExpiresAt = null;
    await db.manager.save(reference);
    await processor.maintain(pending.nextAttemptAt!);
    await expect(storage.stat(original)).rejects.toThrow();
  });

  it('發布交易中途失敗會一起回滾新成果與舊版停用', async () => {
    const document = await documentFixture();
    await addSigned(document, 1);
    const old = await generate(document);
    const oldJob = await db.manager.findOneByOrFail(EsignExportJob, {
      publicId: old.id,
    });
    await addSigned(document, 2);
    // 在真 DB 邊界故障，驗證新 completed 與舊 superseded 確實位於同一交易。
    const trigger = `test_zip_rollback_${oldJob.id}`;
    await db.query(
      `CREATE TRIGGER ${trigger} BEFORE UPDATE ON esign_export_jobs FOR EACH ROW BEGIN IF OLD.id = ${oldJob.id} AND NEW.status = 'superseded' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic publish rollback'; END IF; END`,
    );
    let next: Awaited<ReturnType<typeof generate>>;
    try {
      next = await generate(document);
    } finally {
      await db.query(`DROP TRIGGER ${trigger}`);
    }
    expect(next).toMatchObject({ status: 'failed', files: [] });
    const newJob = await db.manager.findOneByOrFail(EsignExportJob, {
      publicId: next.id,
    });
    expect(
      await db.manager.countBy(EsignFileObject, { exportJobId: newJob.id }),
    ).toBe(0);
    expect(
      (await db.manager.findOneByOrFail(EsignExportJob, { id: oldJob.id }))
        .status,
    ).toBe('completed');
    await request(ctx.server)
      .get(old.files[0].downloadPath)
      .set('Cookie', cookie)
      .expect(200);
  });

  it.each([false, true])(
    '發布已提交但回覆中斷（參照查詢故障=%s）保留新版，維護流程接手舊檔清理',
    async (referenceUnavailable) => {
      const document = await documentFixture();
      await addSigned(document, 1);
      const old = await generate(document);
      const original = await db.manager.findOneByOrFail(EsignFileObject, {
        id: Number(old.files[0].id),
      });
      const personal = await addSigned(document, 2);
      const accepted = await ctx.app
        .get(EsignExportService)
        .request(document.id, user.id);
      const job = await db.manager.findOneByOrFail(EsignExportJob, {
        publicId: accepted.id,
      });
      const mysql = ctx.app.get(MysqlService);
      const transaction = mysql.transaction.bind(mysql);
      let interrupted = false;
      const referenceRead = jest.spyOn(db.manager, 'exists');
      const commitReply = jest
        .spyOn(mysql, 'transaction')
        .mockImplementation(async (run, isolation) => {
          const result = await transaction(run, isolation);
          if (
            !interrupted &&
            (await db.manager.findOneByOrFail(EsignExportJob, { id: job.id }))
              .status === 'completed'
          ) {
            interrupted = true;
            if (referenceUnavailable)
              referenceRead.mockRejectedValueOnce(
                new Error('合成參照查詢中斷'),
              );
            throw new Error('合成 COMMIT 成功後回覆中斷');
          }
          return result;
        });
      try {
        await processor.run(job.id);
      } finally {
        commitReply.mockRestore();
        referenceRead.mockRestore();
      }
      expect(interrupted).toBe(true);
      expect(
        (await db.manager.findOneByOrFail(EsignExportJob, { id: job.id }))
          .status,
      ).toBe('completed');
      const file = await db.manager.findOneByOrFail(EsignFileObject, {
        exportJobId: job.id,
        filePurpose: 'signed_copies_zip',
      });
      expect(await storage.stat(file)).toMatchObject({
        fileSize: Number(file.fileSize),
      });
      await request(ctx.server)
        .get(
          `/api/esign/documents/${document.id}/exports/${job.publicId}/files/${file.id}`,
        )
        .set('Cookie', cookie)
        .expect(200);
      await request(ctx.server)
        .get(old.files[0].downloadPath)
        .set('Cookie', cookie)
        .expect(409);
      expect(await storage.stat(original)).toMatchObject({
        fileSize: Number(original.fileSize),
      });
      await processor.maintain();
      await expect(storage.stat(original)).rejects.toThrow();
      expect(await storage.stat(personal)).toMatchObject({
        fileSize: Number(personal.fileSize),
      });
    },
  );
  it('補清理每輪最多 50 工作，失敗延後不阻塞後續工作', async () => {
    const document = await documentFixture();
    const candidates: EsignFileObject[] = [];
    for (let index = 0; index < 51; index++) {
      const job = await db.manager.save(
        EsignExportJob,
        db.manager.create(EsignExportJob, {
          publicId: randomUUID(),
          documentId: document.id,
          createdByUserId: user.id,
          exportType: 'signed_copies_zip',
          snapshotJson: [],
          snapshotAt: new Date(),
          snapshotSha256: 'd'.repeat(64),
          scopeDescription: '合成補清理',
          status: 'superseded',
          completedAt: new Date(),
        }),
      );
      const stored = await storage.storeStream({
        directory: 'exports',
        extension: 'zip',
        mimeType: 'application/zip',
        stream: Readable.from([Buffer.from('synthetic cleanup candidate')]),
      });
      candidates.push(
        await db.manager.save(
          EsignFileObject,
          db.manager.create(EsignFileObject, {
            ...stored,
            exportJobId: job.id,
            filePurpose: 'signed_copies_zip',
            archiveStatus: 'delete_pending',
          }),
        ),
      );
    }
    const now = new Date();
    const remove = storage.delete.bind(storage);
    const failure = jest
      .spyOn(storage, 'delete')
      .mockImplementation(async (reference) => {
        if (reference.objectKey === candidates[0].objectKey)
          throw new Error('合成持續刪除失敗');
        return remove(reference);
      });
    try {
      await processor.maintain(now);
      expect(
        await db.manager.countBy(EsignFileObject, {
          archiveStatus: 'deleted',
          exportJobId: In(candidates.map((f) => f.exportJobId!)),
        }),
      ).toBe(49);
      const deferred = await db.manager.findOneByOrFail(EsignExportJob, {
        id: candidates[0].exportJobId!,
      });
      expect(deferred.nextAttemptAt).toEqual(new Date(now.getTime() + 60_000));
      await processor.maintain(now);
      expect(
        await db.manager.countBy(EsignFileObject, {
          archiveStatus: 'deleted',
          exportJobId: In(candidates.map((f) => f.exportJobId!)),
        }),
      ).toBe(50);
    } finally {
      failure.mockRestore();
    }
    await processor.maintain(new Date(now.getTime() + 60_000));
    expect(
      await db.manager.countBy(EsignFileObject, {
        archiveStatus: 'deleted',
        exportJobId: In(candidates.map((f) => f.exportJobId!)),
      }),
    ).toBe(51);
  });
});
