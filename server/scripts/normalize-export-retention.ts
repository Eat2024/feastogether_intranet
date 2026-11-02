/** 一次性 ZIP 保存政策工具；不掛入應用啟動或 worker。 */
import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { readFile, open } from 'node:fs/promises';
import { DataSource, type EntityManager } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EsignExportJob } from '#app/features/esign/entities/esign-export-job.entity';
import { EsignFileObject } from '#app/features/esign/entities/esign-file-object.entity';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';
import { createPrivateFileStorage } from '#app/infrastructure/file-storage/file-storage.module';
import type { PrivateFileStorage } from '#app/infrastructure/file-storage/private-file-storage.port';

interface Policy {
  status: string;
  expiresAt: string | null;
  archiveStatus: string | null;
}
interface RetentionEntry {
  jobId: string;
  documentId: string;
  fileId: string | null;
  fixed: boolean;
  decision: 'ready' | 'unchanged' | 'unavailable';
  fingerprint: string;
  before: Policy;
}
export interface RetentionManifest {
  version: 1;
  target: string;
  createdAt: string;
  entries: RetentionEntry[];
  summary: {
    ready: number;
    unchanged: number;
    unavailable: number;
    fixedUnavailable: number;
  };
}
function summary(entries: RetentionEntry[]) {
  return {
    ready: entries.filter((row) => row.decision === 'ready').length,
    unchanged: entries.filter((row) => row.decision === 'unchanged').length,
    unavailable: entries.filter((row) => row.decision === 'unavailable').length,
    fixedUnavailable: entries.filter(
      (row) => row.fixed && row.decision === 'unavailable',
    ).length,
  };
}
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const target = (db: DataSource) =>
  hash(
    db.options.type === 'mysql'
      ? [db.options.host, db.options.port, db.options.database]
      : [db.options.type, db.options.database],
  );
const policy = (job: EsignExportJob, file: EsignFileObject | null): Policy => ({
  status: job.status,
  expiresAt: job.expiresAt?.toISOString() ?? null,
  archiveStatus: file?.archiveStatus ?? null,
});
const normalized = (p: Policy) =>
  p.status === 'completed' &&
  p.expiresAt === null &&
  p.archiveStatus === 'active';

function fingerprint(job: EsignExportJob, file: EsignFileObject | null) {
  // 指紋固定原產物與快照；物件位置只在記憶體中參與雜湊，不寫進報告。
  return hash([
    job.id,
    job.publicId,
    job.documentId,
    job.createdAt,
    job.completedAt,
    job.snapshotSha256,
    file && [
      file.id,
      file.objectKey,
      file.objectVersion,
      file.fileSize,
      file.sha256,
      file.createdAt,
      file.filePurpose,
      file.mimeType,
    ],
  ]);
}
function candidates(manager: EntityManager) {
  return manager
    .createQueryBuilder(EsignExportJob, 'job')
    .select([
      'job.id',
      'job.publicId',
      'job.documentId',
      'job.status',
      'job.completedAt',
      'job.expiresAt',
      'job.createdAt',
      'job.snapshotSha256',
    ])
    .where(
      "job.exportType = 'signed_copies_zip' AND job.snapshotJson IS NOT NULL",
    )
    .andWhere(
      "(job.status IN ('completed','expired') OR job.completedAt IS NOT NULL)",
    );
}
async function fileFor(
  manager: EntityManager,
  job: EsignExportJob,
  lock = false,
) {
  return manager.findOne(EsignFileObject, {
    where: { exportJobId: job.id, filePurpose: 'signed_copies_zip' },
    ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
  });
}
async function validArtifact(
  job: EsignExportJob,
  file: EsignFileObject | null,
  storage: PrivateFileStorage,
): Promise<boolean> {
  if (
    !job.documentId ||
    !job.completedAt ||
    !['completed', 'expired'].includes(job.status) ||
    !file ||
    !['active', 'expired'].includes(file.archiveStatus) ||
    file.mimeType !== 'application/zip' ||
    file.documentId ||
    file.signatureRecordId ||
    file.verificationRecordId ||
    file.documentFieldId
  )
    return false;
  try {
    const expectedSize = Number(file.fileSize);
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 0) return false;
    if (storage.stat && (await storage.stat(file)).fileSize !== expectedSize)
      return false;
    const stream = await storage.openReadStream(file);
    const digest = createHash('sha256');
    let size = 0;
    try {
      for await (const chunk of stream) {
        if (!(chunk instanceof Uint8Array)) return false;
        size += chunk.byteLength;
        if (size > expectedSize) return false;
        digest.update(chunk);
      }
      return size === expectedSize && digest.digest('hex') === file.sha256;
    } finally {
      stream.destroy();
    }
  } catch {
    return false;
  }
}

/** 唯讀盤點；只回傳識別、政策前值與不可逆指紋。 */
export async function inspectExportRetention(
  db: DataSource,
  storage: PrivateFileStorage,
): Promise<RetentionManifest> {
  const entries: RetentionEntry[] = [];
  const selectedDocuments = new Set<string>();
  let beforeId: string | undefined;
  while (true) {
    const query = candidates(db.manager).orderBy('job.id', 'DESC').take(100);
    if (beforeId) query.andWhere('job.id < :beforeId', { beforeId });
    const jobs = await query.getMany();
    if (!jobs.length) break;
    for (const job of jobs) {
      const documentId = String(job.documentId);
      const wasCompleted =
        job.completedAt != null ||
        job.status === 'completed' ||
        job.status === 'expired';
      const fixed = wasCompleted && !selectedDocuments.has(documentId);
      if (wasCompleted) selectedDocuments.add(documentId);
      const file = await fileFor(db.manager, job);
      const before = policy(job, file);
      const valid = await validArtifact(job, file, storage);
      entries.push({
        jobId: String(job.id),
        documentId,
        fileId: file ? String(file.id) : null,
        fixed,
        before,
        fingerprint: fingerprint(job, file),
        decision: !valid
          ? 'unavailable'
          : normalized(before)
            ? 'unchanged'
            : 'ready',
      });
    }
    beforeId = String(jobs[jobs.length - 1].id);
  }
  return {
    version: 1,
    target: target(db),
    createdAt: new Date().toISOString(),
    entries,
    summary: summary(entries),
  };
}

/** 僅接受完整盤點格式，防止誤把任意 ID 清單當成已核對的 manifest。 */
export function parseRetentionManifest(raw: unknown): RetentionManifest {
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('version' in raw) ||
    raw.version !== 1 ||
    !('target' in raw) ||
    typeof raw.target !== 'string' ||
    !/^[a-f0-9]{64}$/.test(raw.target) ||
    !('createdAt' in raw) ||
    typeof raw.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(raw.createdAt)) ||
    !('entries' in raw) ||
    !Array.isArray(raw.entries)
  )
    throw new Error('盤點清單格式不正確');
  const entries: RetentionEntry[] = [];
  const ids = new Set<string>();
  for (const candidate of raw.entries as unknown[]) {
    if (!candidate || typeof candidate !== 'object')
      throw new Error('盤點項目格式不正確');
    const row = candidate as Record<string, unknown>;
    const before = row.before as Record<string, unknown> | undefined;
    if (
      typeof row.jobId !== 'string' ||
      !/^[1-9][0-9]{0,14}$/.test(row.jobId) ||
      ids.has(row.jobId) ||
      typeof row.documentId !== 'string' ||
      !/^[1-9][0-9]{0,14}$/.test(row.documentId) ||
      !(
        row.fileId === null ||
        (typeof row.fileId === 'string' &&
          /^[1-9][0-9]{0,14}$/.test(row.fileId))
      ) ||
      typeof row.fixed !== 'boolean' ||
      !['ready', 'unchanged', 'unavailable'].includes(String(row.decision)) ||
      typeof row.fingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(row.fingerprint) ||
      !before ||
      typeof before.status !== 'string' ||
      !(
        before.expiresAt === null ||
        (typeof before.expiresAt === 'string' &&
          Number.isFinite(Date.parse(before.expiresAt)))
      ) ||
      !(
        before.archiveStatus === null ||
        typeof before.archiveStatus === 'string'
      )
    )
      throw new Error('盤點項目格式不正確');
    ids.add(row.jobId);
    entries.push({
      jobId: row.jobId,
      documentId: row.documentId,
      fileId: row.fileId,
      fixed: row.fixed,
      decision: row.decision as RetentionEntry['decision'],
      fingerprint: row.fingerprint,
      before: {
        status: before.status,
        expiresAt: before.expiresAt,
        archiveStatus: before.archiveStatus,
      },
    });
  }
  return {
    version: 1,
    target: raw.target,
    createdAt: raw.createdAt,
    entries,
    summary: summary(entries),
  };
}

/** 逐筆鎖定與重新驗證；清單前值可供受控回滾，已完成的項目重跑不寫入。 */
export async function applyExportRetention(
  db: DataSource,
  storage: PrivateFileStorage,
  input: RetentionManifest,
) {
  const manifest = parseRetentionManifest(input);
  if (manifest.target !== target(db))
    throw new Error('盤點清單不屬於目前資料庫');
  const results: Array<{
    jobId: string;
    result: 'applied' | 'unchanged' | 'unavailable' | 'changed';
  }> = [];
  for (const entry of manifest.entries) {
    if (entry.decision === 'unavailable') {
      results.push({ jobId: entry.jobId, result: 'unavailable' });
      continue;
    }
    const result = await db.transaction(async (manager) => {
      const job = await candidates(manager)
        .andWhere('job.id=:id', { id: entry.jobId })
        .setLock('pessimistic_write')
        .getOne();
      if (!job) return 'changed' as const;
      const file = await fileFor(manager, job, true);
      if (
        fingerprint(job, file) !== entry.fingerprint ||
        String(job.documentId) !== entry.documentId ||
        (file ? String(file.id) : null) !== entry.fileId
      )
        return 'changed' as const;
      const current = policy(job, file);
      if (!normalized(current) && hash(current) !== hash(entry.before))
        return 'changed' as const;
      if (!(await validArtifact(job, file, storage)) || !file)
        return 'unavailable' as const;
      if (normalized(current)) return 'unchanged' as const;
      job.status = 'completed';
      job.expiresAt = null;
      file.archiveStatus = 'active';
      await manager.save(EsignExportJob, job);
      await manager.save(EsignFileObject, file);
      return 'applied' as const;
    });
    results.push({ jobId: entry.jobId, result });
  }
  return results;
}

/** 輸出只允許新檔，避免覆寫核對清單；寫入並 fsync 後才可開始 apply。 */
async function saveReport(path: string, value: unknown) {
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(value, null, 2) + '\n');
    await file.sync();
  } finally {
    await file.close();
  }
}
async function main(args: string[]) {
  const apply = args[0] === '--apply';
  const valid = apply
    ? args.length === 4 && args[2] === '--receipt'
    : args.length === 2 && args[0] === '--output';
  if (!valid)
    throw new Error(
      '用法：--output <新盤點檔>；或 --apply <核對清單> --receipt <新執行紀錄檔>',
    );
  const db = new DataSource({ ...buildMysqlOptions(), logging: false });
  try {
    await db.initialize();
    const storage = createPrivateFileStorage(new ConfigService(process.env));
    if (!apply) {
      await saveReport(args[1], await inspectExportRetention(db, storage));
      return;
    }
    const manifest = parseRetentionManifest(
      JSON.parse(await readFile(args[1], 'utf8')) as unknown,
    );
    if (manifest.target !== target(db))
      throw new Error('盤點清單不屬於目前資料庫');
    // 先保存不可覆寫的前值；中途停止時可依原清單重跑，不遺失回滾資訊。
    await saveReport(args[3], {
      manifest,
      startedAt: new Date().toISOString(),
    });
    const results = await applyExportRetention(db, storage, manifest);
    await saveReport(args[3] + '.results.json', {
      results,
      finishedAt: new Date().toISOString(),
    });
    if (results.some((row) => ['changed', 'unavailable'].includes(row.result)))
      process.exitCode = 2;
  } finally {
    if (db.isInitialized) await db.destroy();
  }
}
if (require.main === module) {
  void main(process.argv.slice(2)).catch(() => {
    console.error(
      'ZIP 保存政策工具未完成，請檢查受控清單、資料庫與儲存服務；未輸出來源錯誤以避免洩漏連線資訊。',
    );
    process.exitCode = 1;
  });
}
