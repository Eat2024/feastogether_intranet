/* eslint-disable @typescript-eslint/no-require-imports -- 測試設定必須先於 Nest 模組載入。 */
/** Spec030 真 HTTP / Redis / MySQL / local worker 按需更新容量驗證，詳見 README。 */
import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { fork, execFileSync, type ChildProcess } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readFile, writeFile, link, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cpus, totalmem, release, platform } from 'node:os';
import { once } from 'node:events';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import { assertTestDbName } from '#app/infrastructure/database/test/ensure-test-db';
type Sample = {
  at: number;
  rss: number;
  heapUsed: number;
  external: number;
  cpu: NodeJS.CpuUsage;
  eventLoopMaxMs: number;
  arrayBuffers: number;
};
type Corpus = { files: Array<{ name: string; bytes: number; sha256: string }> };
type ExportView = {
  id: string;
  status: string;
  expectedCount: number;
  processedCount: number;
  failureCode?: string;
  files: Array<{ downloadPath: string; size: number; sha256: string }>;
};
const origin = 'http://localhost:3000',
  sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mode = process.argv[2] ?? 'run',
  output = resolve(process.argv[3] ?? '/tmp/esign009-capacity-run'),
  corpusRoot = resolve(process.argv[4] ?? '/tmp/esign009-capacity-prep'),
  count = Number(process.argv[5] ?? 6000);
const samples: Sample[] = [],
  workers: ChildProcess[] = [],
  childSamples: Record<string, Sample[]> = {};
const eventLoop = monitorEventLoopDelay({ resolution: 10 });
eventLoop.enable();
function measure() {
  const { rss, heapUsed, external, arrayBuffers } = process.memoryUsage();
  const eventLoopMaxMs = eventLoop.max / 1e6;
  eventLoop.reset();
  return {
    at: Date.now(),
    rss,
    heapUsed,
    external,
    arrayBuffers,
    eventLoopMaxMs,
    cpu: process.cpuUsage(),
  };
}
async function worker() {
  assertTestDbName();
  if (
    !process.env.DB_MYSQL_DB?.startsWith(
      'feastogether_intranet_test_capacity_',
    ) ||
    process.env.ESIGN_STORAGE_DRIVER !== 'local' ||
    !process.env.ESIGN_STORAGE_ROOT?.startsWith('/tmp/esign009-capacity-')
  )
    throw new Error('worker 必須使用隔離容量環境');
  const compression = 'store';
  const { NestFactory } =
    require('@nestjs/core') as typeof import('@nestjs/core');
  const { WorkerModule } =
    require('#app/worker.module') as typeof import('#app/worker.module');
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: false,
  });
  const timer = setInterval(
    () => process.send?.({ kind: 'sample', sample: measure() }),
    250,
  );
  const sourceHash = createHash('sha256')
    .update(
      await readFile(
        join(__dirname, '../../src/worker/esign/document-export.processor.ts'),
      ),
    )
    .digest('hex');
  await writeFile(
    join(output, `worker-${process.pid}-version.json`),
    JSON.stringify({ compression, sourceHash, node: process.version }, null, 2),
  );
  process.send?.({ kind: 'ready' });
  process.on('message', (m: string) => {
    if (m === 'stop')
      void (async () => {
        clearInterval(timer);
        await app.close();
        process.exit(0);
      })();
  });
}
async function startWorker(compression = 'store') {
  const child = fork(
    __filename,
    ['worker', output, corpusRoot, String(count), compression],
    {
      execArgv: ['--conditions=development', '-r', 'ts-node/register'],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: process.env,
    },
  );
  workers.push(child);
  const key = String(child.pid);
  childSamples[key] = [];
  child.stderr?.on('data', (b: Buffer) => {
    void writeFile(join(output, `worker-${key}.stderr`), b, { flag: 'a' });
  });
  await new Promise<void>((ready, reject) => {
    child.on('message', (m: { kind: string; sample: Sample }) => {
      if (m.kind === 'ready') ready();
      if (m.kind === 'sample') childSamples[key].push(m.sample);
    });
    child.once('exit', (code) => {
      if (code) reject(new Error(`worker exit ${code}`));
    });
  });
  return child;
}
async function stopWorker(w: ChildProcess) {
  if (w.exitCode === null && !w.killed) {
    w.send('stop');
    await once(w, 'exit');
  }
}
function responseStream(body: NonNullable<Response['body']>) {
  return Readable.from(
    (async function* () {
      const reader = body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return;
          yield value;
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    })(),
    { objectMode: false },
  );
}

async function verifyResumedDownload(
  base: string,
  cookie: string,
  file: ExportView['files'][number],
  target: string,
) {
  const abort = new AbortController();
  const first = await fetch(base + file.downloadPath, {
    headers: { Cookie: cookie },
    signal: abort.signal,
  });
  if (first.status !== 200 || !first.body) throw new Error('下載失敗');
  let received = 0;
  const sink = createWriteStream(target);
  try {
    for await (const data of responseStream(first.body)) {
      const b = Buffer.from(data);
      received += b.length;
      if (!sink.write(b)) await once(sink, 'drain');
      if (received >= 8 * 1024 * 1024) {
        abort.abort();
        break;
      }
    }
  } finally {
    sink.end();
    await once(sink, 'finish');
  }
  const continuation = await fetch(base + file.downloadPath, {
    headers: {
      Cookie: cookie,
      Range: `bytes=${received}-`,
      'If-Range': `"${file.sha256}"`,
    },
    signal: AbortSignal.timeout(120_000),
  });
  if (continuation.status !== 206 || !continuation.body)
    throw new Error('續傳失敗');
  await pipeline(
    responseStream(continuation.body),
    createWriteStream(target, { flags: 'a' }),
  );
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const b of createReadStream(target)) {
    if (!Buffer.isBuffer(b)) throw new Error('下載不是 bytes');
    hash.update(b);
    bytes += b.length;
  }
  if (hash.digest('hex') !== file.sha256 || bytes !== file.size)
    throw new Error('續傳完整性不符');
  await rm(target);
}

async function run() {
  assertTestDbName();
  assert.equal(mode, 'run');
  assert.ok([24, 6000].includes(count));
  assert.ok(
    process.env.DB_MYSQL_DB?.startsWith('feastogether_intranet_test_capacity_'),
  );
  assert.equal(process.env.ESIGN_STORAGE_DRIVER, 'local');
  const storageRoot = process.env.ESIGN_STORAGE_ROOT!;
  assert.ok(storageRoot?.startsWith('/tmp/esign009-capacity-'));
  await mkdir(output); // 不覆寫既有結果或既有 storage。
  await mkdir(storageRoot);
  await writeFile(
    join(output, 'started.json'),
    JSON.stringify(
      {
        at: new Date(),
        count,
        machine: {
          cpu: cpus()[0].model,
          cores: cpus().length,
          ram: totalmem(),
          os: platform(),
          release: release(),
          node: process.version,
        },
        corpus:
          '24 種合成 PDF 平衡重複，hardlink、熱快取；不是 6000 份獨特真實文件',
      },
      null,
      2,
    ),
  );
  require('../setup-e2e');
  const { default: setup } =
    require('../global-setup') as typeof import('../global-setup');
  await setup();
  const { createSecurityE2eApp, closeSecurityE2eApp } =
    require('../security-e2e.helper') as typeof import('../security-e2e.helper');
  const { createDepartmentFixtures } =
    require('../department-visibility.helper') as typeof import('../department-visibility.helper');
  const { EsignSigner } =
    require('#app/features/esign/entities/esign-signer.entity') as typeof import('#app/features/esign/entities/esign-signer.entity');
  const { EsignSignatureRecord } =
    require('#app/features/esign/entities/esign-signature-record.entity') as typeof import('#app/features/esign/entities/esign-signature-record.entity');
  const { EsignFileObject } =
    require('#app/features/esign/entities/esign-file-object.entity') as typeof import('#app/features/esign/entities/esign-file-object.entity');
  const { EsignExportJob } =
    require('#app/features/esign/entities/esign-export-job.entity') as typeof import('#app/features/esign/entities/esign-export-job.entity');
  const { MYSQL_MAIN } =
    require('#app/infrastructure/database/mysql/mysql.tokens') as typeof import('#app/infrastructure/database/mysql/mysql.tokens');
  const ctx = await createSecurityE2eApp();
  const timer = setInterval(() => samples.push(measure()), 250);
  try {
    const db = ctx.app.get<DataSource>(MYSQL_MAIN);
    const [existing] = await db.query<Array<{ count: number }>>(
      'SELECT COUNT(*) AS count FROM esign_documents',
    );
    assert.equal(Number(existing.count), 0, '只能使用新空白測試 DB');
    const fixture = await createDepartmentFixtures(ctx);
    const doc = await fixture.createDocument(fixture.users.a1, {
      status: 'active',
      title: '合成 ZIP 更新容量',
      signStartAt: new Date(Date.now() - 60000),
      signEndAt: new Date(Date.now() + 86400000),
    });
    const manifest = JSON.parse(
      await readFile(join(corpusRoot, 'manifest.json'), 'utf8'),
    ) as Corpus;
    assert.equal(manifest.files.length, 24);
    const expected: Array<{ zipPath: string; bytes: number; sha256: string }> =
      [];
    await mkdir(join(storageRoot, 'capacity-sources'));
    // fixture 使用真 DB 和真 PDF；簽署服務本身的驗證由 e2e 套件涵蓋。
    async function seed(start: number, end: number) {
      for (let i = start; i < end; i++) {
        const source = manifest.files[i % manifest.files.length];
        const objectKey = `capacity-sources/${i}.pdf`;
        await link(
          join(corpusRoot, 'corpus', source.name),
          join(storageRoot, objectKey),
        );
        const signer = await db.manager.save(
          EsignSigner,
          db.manager.create(EsignSigner, {
            publicId: randomUUID(),
            documentId: doc.id,
            signerType: 'email',
            email: `capacity-${i}@example.test`,
            nameSnapshot: `合成-${i}`,
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
            consentVersion: 'synthetic',
            authenticationMethod: 'synthetic',
            authenticationEventId: randomUUID(),
            signedAtUtc: new Date(),
          }),
        );
        await db.manager.insert(EsignFileObject, {
          signatureRecordId: record.id,
          filePurpose: 'completed_pdf',
          archiveStatus: 'active',
          storageDriver: 'local',
          objectKey,
          mimeType: 'application/pdf',
          fileSize: source.bytes,
          sha256: source.sha256,
        });
        expected.push({
          zipPath: `副本_合成-${i}_${signer.publicId}.pdf`,
          bytes: source.bytes,
          sha256: source.sha256,
        });
      }
    }
    await ctx.app.listen(0, '127.0.0.1');
    const address = (ctx.server as import('node:http').Server).address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const cookie = fixture.cookies.a1;
    const endpoint = `/api/esign/documents/${doc.id}`;
    async function http<T>(path: string, body?: unknown) {
      const began = performance.now();
      const response = await fetch(base + path, {
        signal: AbortSignal.timeout(120000),
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Cookie: cookie,
          Origin: origin,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const json = (await response.json()) as { data: T; error?: unknown };
      assert.ok(
        response.ok,
        `${path} ${response.status} ${JSON.stringify(json.error)}`,
      );
      return {
        data: json.data,
        status: response.status,
        ms: performance.now() - began,
      };
    }
    async function preview() {
      return (
        await http<{
          exportState: {
            current: { id: string };
            work: unknown;
            currentNewSignatureCount: number;
          };
        }>(endpoint + '?view=export')
      ).data.exportState;
    }
    async function job(id: string) {
      return (await http<ExportView>(`${endpoint}/exports/${id}`)).data;
    }
    async function completed(id: string) {
      const until = Date.now() + 180000;
      while (Date.now() < until) {
        const current = await job(id);
        if (current.status === 'completed') return current;
        assert.notEqual(current.status, 'failed', JSON.stringify(current));
        await sleep(100);
      }
      throw new Error('匯出逾時');
    }
    const workerProcess = await startWorker();
    await seed(0, 1);
    const first = await http<ExportView>(endpoint + '/exports', {
      type: 'signed_copies_zip',
    });
    assert.equal(first.status, 202);
    const oldView = await completed(first.data.id);
    const oldJob = await db.manager.findOneByOrFail(EsignExportJob, {
      publicId: first.data.id,
    });
    const oldFile = await db.manager.findOneByOrFail(EsignFileObject, {
      exportJobId: oldJob.id,
    });
    await access(join(storageRoot, oldFile.objectKey));
    await seed(1, count);
    assert.equal((await preview()).currentNewSignatureCount, count - 1);
    assert.equal(
      await db.manager.count(EsignExportJob, { where: { documentId: doc.id } }),
      1,
      '新簽署不能自動建立工作',
    );
    const acceptedAt = Date.now();
    const update = await http<ExportView>(endpoint + '/exports', {
      type: 'signed_copies_zip',
    });
    assert.equal(update.status, 202);
    assert.equal(update.data.expectedCount, count);
    let state = await job(update.data.id);
    const deadline = Date.now() + 30000;
    while (state.status !== 'processing' && Date.now() < deadline) {
      assert.notEqual(state.status, 'completed', '必須實際在處理中加入簽署');
      await sleep(20);
      state = await job(update.data.id);
    }
    assert.equal(state.status, 'processing');
    const processingObserved = Date.now();
    await seed(count, count + 1);
    assert.equal(
      (await job(update.data.id)).status,
      'processing',
      '新增紀錄必須落在處理期間',
    );
    const reuse = await http<ExportView>(endpoint + '/exports', {
      type: 'signed_copies_zip',
    });
    assert.equal(reuse.data.id, update.data.id);
    assert.equal(reuse.data.expectedCount, count);
    const result = await completed(update.data.id);
    const completedAt = Date.now();
    assert.equal(result.expectedCount, count);
    assert.equal(result.processedCount, count);
    const latest = await db.manager.findOneByOrFail(EsignExportJob, {
      publicId: result.id,
    });
    const zip = await db.manager.findOneByOrFail(EsignFileObject, {
      exportJobId: latest.id,
    });
    // 清理由正式 worker 完成；不手動刪 ZIP 或修改狀態冒充回收。
    const cleanupDeadline = Date.now() + 10000;
    let cleaned = await db.manager.findOneByOrFail(EsignFileObject, {
      id: oldFile.id,
    });
    while (
      cleaned.archiveStatus !== 'deleted' &&
      Date.now() < cleanupDeadline
    ) {
      await sleep(100);
      cleaned = await db.manager.findOneByOrFail(EsignFileObject, {
        id: oldFile.id,
      });
    }
    assert.equal(cleaned.archiveStatus, 'deleted');
    assert.equal(
      (await db.manager.findOneByOrFail(EsignExportJob, { id: oldJob.id }))
        .status,
      'superseded',
    );
    await assert.rejects(access(join(storageRoot, oldFile.objectKey)), {
      code: 'ENOENT',
    });
    for (let i = 0; i <= count; i++)
      await access(join(storageRoot, `capacity-sources/${i}.pdf`));
    const current = await preview();
    assert.equal(current.current.id, result.id);
    assert.equal(current.work, null);
    assert.equal(current.currentNewSignatureCount, 1);
    assert.equal(
      await db.manager.count(EsignExportJob, { where: { documentId: doc.id } }),
      2,
    );

    const expectedFile = join(output, 'expected.json');
    await writeFile(
      expectedFile,
      JSON.stringify(
        {
          entries: expected.slice(0, count),
          totalBytes: expected
            .slice(0, count)
            .reduce((sum, file) => sum + file.bytes, 0),
        },
        null,
        2,
      ),
    );
    execFileSync(
      'python3',
      [
        join(__dirname, 'verify-export-zip.py'),
        join(storageRoot, zip.objectKey),
        expectedFile,
        ...(count === 6000 ? ['--require-zip64'] : []),
        '--output',
        join(output, 'verify.json'),
      ],
      { stdio: 'inherit' },
    );
    await verifyResumedDownload(
      base,
      cookie,
      result.files[0],
      join(output, 'download.tmp.zip'),
    );
    const denied = await fetch(base + oldView.files[0].downloadPath, {
      headers: { Cookie: cookie, Range: 'bytes=0-3' },
    });
    assert.equal(denied.status, 409);
    await denied.body?.cancel();
    const anonymous = await fetch(base + result.files[0].downloadPath, {
      headers: { Range: 'bytes=0-3' },
    });
    assert.equal(anonymous.status, 401);
    await anonymous.body?.cancel();
    assert.equal(
      await db.manager.count(EsignExportJob, { where: { documentId: doc.id } }),
      2,
    );
    // 再次明確更新：大型舊快照也須能取代與清理，不能只驗證一份舊版。
    const third = await http<ExportView>(endpoint + '/exports', {
      type: 'signed_copies_zip',
    });
    assert.equal(third.status, 202);
    assert.equal(third.data.expectedCount, count + 1);
    const thirdResult = await completed(third.data.id);
    const largeCleanupDeadline = Date.now() + 10000;
    let previous = await db.manager.findOneByOrFail(EsignFileObject, {
      id: zip.id,
    });
    while (
      previous.archiveStatus !== 'deleted' &&
      Date.now() < largeCleanupDeadline
    ) {
      await sleep(100);
      previous = await db.manager.findOneByOrFail(EsignFileObject, {
        id: zip.id,
      });
    }
    assert.equal(previous.archiveStatus, 'deleted');
    await assert.rejects(access(join(storageRoot, zip.objectKey)), {
      code: 'ENOENT',
    });
    assert.equal((await preview()).currentNewSignatureCount, 0);
    assert.equal(
      await db.manager.count(EsignExportJob, { where: { documentId: doc.id } }),
      3,
    );
    const thirdJob = await db.manager.findOneByOrFail(EsignExportJob, {
      publicId: thirdResult.id,
    });
    const thirdFile = await db.manager.findOneByOrFail(EsignFileObject, {
      exportJobId: thirdJob.id,
    });
    await writeFile(
      join(output, 'expected-next.json'),
      JSON.stringify({
        entries: expected,
        totalBytes: expected.reduce((sum, file) => sum + file.bytes, 0),
      }),
    );
    execFileSync(
      'python3',
      [
        join(__dirname, 'verify-export-zip.py'),
        join(storageRoot, thirdFile.objectKey),
        join(output, 'expected-next.json'),
        ...(count === 6000 ? ['--require-zip64'] : []),
        '--output',
        join(output, 'verify-next.json'),
      ],
      { stdio: 'inherit' },
    );
    await stopWorker(workerProcess);
    const activeWorker = Object.values(childSamples)
      .flat()
      .filter(
        (sample) => sample.at >= processingObserved && sample.at <= completedAt,
      );
    const activeApi = samples.filter(
      (sample) => sample.at >= processingObserved && sample.at <= completedAt,
    );
    assert.ok(activeWorker.length > 0);
    await writeFile(
      join(output, 'result.json'),
      JSON.stringify(
        {
          passed: true,
          subsequentExplicitUpdateCount: count + 1,
          largePreviousZipDeleted: true,
          finalTotalJobs: 3,
          count,
          documentId: doc.id,
          oldJobId: first.data.id,
          newJobId: result.id,
          acceptedAt,
          processingObserved,
          completedAt,
          requestMs: update.ms,
          acceptedToCompletedMs: completedAt - acceptedAt,
          processingObservedMs: completedAt - processingObserved,
          workerPeakRssMiB:
            Math.max(...activeWorker.map((sample) => sample.rss)) / 2 ** 20,
          apiOrchestratorPeakRssMiB:
            Math.max(...activeApi.map((sample) => sample.rss)) / 2 ** 20,
          zipBytes: Number(zip.fileSize),
          sourceBytes: expected
            .slice(0, count)
            .reduce((sum, file) => sum + file.bytes, 0),
          newSignatureDuringProcessing: true,
          fixedSnapshotCount: count,
          totalJobs: 2,
          staleCountAfterCompletion: 1,
          oldJobStatus: 'superseded',
          oldFileStatus: cleaned.archiveStatus,
          oldPhysicalFileAbsent: true,
          personalPdfCount: count + 1,
          resumedDownloadHashVerified: true,
          oldRangeStatus: denied.status,
          anonymousStatus: anonymous.status,
        },
        null,
        2,
      ),
    );
    console.log(
      'Spec030 更新容量驗證成功；結果：' + join(output, 'result.json'),
    );
  } finally {
    clearInterval(timer);
    eventLoop.disable();
    for (const child of workers) await stopWorker(child);
    await writeFile(
      join(output, 'resources.json'),
      JSON.stringify({ apiOrchestrator: samples, workers: childSamples }),
    );
    await closeSecurityE2eApp(ctx);
  }
}
void (mode === 'worker' ? worker() : run()).catch((error: unknown) => {
  console.error(error);
  for (const child of workers) child.kill();
  process.exitCode = 1;
});
