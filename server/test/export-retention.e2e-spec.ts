import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { DataSource } from 'typeorm';
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
