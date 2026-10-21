/* eslint-disable @typescript-eslint/no-require-imports -- 測試設定必須先於 Nest 模組載入；compression factory 僅在隔離子程序 patch。 */
/** 隔離真 HTTP / Redis / MySQL / local worker 容量實驗，詳見 README。 */
import 'reflect-metadata';
import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto';
import { fork, execFileSync, type ChildProcess } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readFile, writeFile, link, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cpus, totalmem, release, platform } from 'node:os';
import { once } from 'node:events';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
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
type SignTask = { cookie: string; ip: string; publicId: string; body: unknown };
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
function p95(v: number[]) {
  return [...v].sort((a, b) => a - b)[Math.ceil(v.length * 0.95) - 1];
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
  // 僅 benchmark 子程序替換壓縮參數，不新增正式 env 或改 production source。
  const compression = process.argv[6] ?? 'store';
  if (compression !== 'store') {
    const id = require.resolve('archiver');
    const original = require(id) as typeof import('archiver');
    const cached = require.cache[id];
    if (!cached) throw new Error('archiver missing');
    cached.exports = Object.assign(
      (format: 'zip', options: object) =>
        original(format, {
          ...options,
          store: false,
          zlib: { level: Number(compression) },
        }),
      original,
    );
  }
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
  if (
    !['run', 'fault'].includes(mode) ||
    ![24, 6000].includes(count) ||
    (mode === 'fault' && count !== 6000)
  )
    throw new Error('模式為 run/fault；容量 24 或 6000；fault 必須 6000');
  assertTestDbName();
  if (
    !process.env.DB_MYSQL_DB?.startsWith('feastogether_intranet_test_capacity_')
  )
    throw new Error('必須獨立 capacity DB');
  if (
    process.env.ESIGN_STORAGE_DRIVER !== 'local' ||
    !process.env.ESIGN_STORAGE_ROOT?.startsWith('/tmp/esign009-capacity-')
  )
    throw new Error('必須隔離 local storage');
  await mkdir(output); // 已存在即中止，避免覆寫既有量測證據。
  await writeFile(
    join(output, 'started.json'),
    JSON.stringify(
      {
        started: new Date(),
        machine: {
          cpu: cpus()[0].model,
          cores: cpus().length,
          ram: totalmem(),
          os: platform(),
          release: release(),
          node: process.version,
        },
        count,
      },
      null,
      2,
    ),
  );
  require('../setup-e2e');
  const { default: setup } =
    require('../global-setup') as typeof import('../global-setup');
  await setup();
  const { createSecurityE2eApp } =
    require('../security-e2e.helper') as typeof import('../security-e2e.helper');
  const { FeastogetherHrService } =
    require('#app/infrastructure/http-client/feastogether/services/feastogether-hr.service') as typeof import('#app/infrastructure/http-client/feastogether/services/feastogether-hr.service');
  const ctx = await createSecurityE2eApp((b) =>
    b.overrideProvider(FeastogetherHrService).useValue({
      lookupEligibleStaff: (empid: string) =>
        Promise.resolve({
          person_empid: empid,
          person_name: '合成容量員工',
          person_status: 1,
          person_status_name: '正式',
          department_id: 'CAP009',
          department_name: '合成部門',
          title: '合成員工',
        }),
    }),
  );
  await ctx.app.listen(0, '127.0.0.1');
  const address = (ctx.server as import('node:http').Server).address();
  if (!address || typeof address === 'string')
    throw new Error('address missing');
  const base = `http://127.0.0.1:${address.port}`;
  const { MYSQL_MAIN } =
    require('#app/infrastructure/database/mysql/mysql.tokens') as typeof import('#app/infrastructure/database/mysql/mysql.tokens');
  const db = ctx.app.get<DataSource>(MYSQL_MAIN);
  const [existing] = await db.query<Array<{ count: number }>>(
    'SELECT COUNT(*) AS count FROM esign_documents',
  );
  if (Number(existing.count) !== 0) {
    await ctx.app.close();
    throw new Error('容量測試必須使用空的新測試 DB');
  }
  const timer = setInterval(() => samples.push(measure()), 250);
  async function http<T>(
    path: string,
    cookie = '',
    body?: unknown,
    ip = '192.0.2.1',
  ) {
    const began = performance.now();
    const r = await fetch(base + path, {
      signal: AbortSignal.timeout(120_000),
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Cookie: cookie,
        Origin: origin,
        'Content-Type': 'application/json',
        'X-Forwarded-For': ip,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const j = (await r.json()) as {
      data: T;
      error?: { code: string; message: string };
    };
    if (!r.ok)
      throw new Error(`${path} HTTP ${r.status}: ${JSON.stringify(j.error)}`);
    return { data: j.data, status: r.status, ms: performance.now() - began };
  }
  async function login(empid: string, index: number) {
    const enc = (v: unknown) =>
        Buffer.from(JSON.stringify(v)).toString('base64url'),
      now = Math.floor(Date.now() / 1000);
    const h = enc({ alg: 'RS256', typ: 'FT-ESIGN-LAUNCH+JWT' }),
      p = enc({
        iss: 'e2e-main-platform',
        aud: 'e2e-esign',
        sub: empid,
        jti: randomUUID(),
        iat: now,
        nbf: now,
        exp: now + 120,
      });
    const signature = sign(
      'RSA-SHA256',
      Buffer.from(`${h}.${p}`),
      createPrivateKey(
        Buffer.from(process.env.WEBVIEW_TEST_PRIVATE_KEY_B64!, 'base64'),
      ),
    ).toString('base64url');
    const ip = `198.18.${Math.floor(index / 250)}.${(index % 250) + 1}`;
    const launched = await fetch(base + '/api/auth/webview-launches', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${h}.${p}.${signature}`,
        'X-Forwarded-For': ip,
      },
    });
    const v = (await launched.json()) as { data: { launchUrl: string } };
    if (!launched.ok) throw new Error(`login ${launched.status}`);
    const code = new URL(v.data.launchUrl).searchParams.get('code')!;
    const session = await fetch(base + '/api/auth/session', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Forwarded-For': ip,
      },
      body: new URLSearchParams({ code }),
    });
    const cookie = session.headers.get('set-cookie')?.split(';')[0];
    if (session.status !== 303 || !cookie) throw new Error('session failed');
    return { cookie, ip };
  }
  const owner = await login('CAPOWNER', 0);
  const [ownerUser] = await db.query<Array<{ id: number }>>(
    'SELECT id FROM users WHERE empid=?',
    ['CAPOWNER'],
  );
  const { EsignDocument } =
    require('#app/features/esign/entities/esign-document.entity') as typeof import('#app/features/esign/entities/esign-document.entity');
  const { EsignSigner } =
    require('#app/features/esign/entities/esign-signer.entity') as typeof import('#app/features/esign/entities/esign-signer.entity');
  const { EsignSignatureRecord } =
    require('#app/features/esign/entities/esign-signature-record.entity') as typeof import('#app/features/esign/entities/esign-signature-record.entity');
  const { EsignFileObject } =
    require('#app/features/esign/entities/esign-file-object.entity') as typeof import('#app/features/esign/entities/esign-file-object.entity');
  const { EsignExportJob } =
    require('#app/features/esign/entities/esign-export-job.entity') as typeof import('#app/features/esign/entities/esign-export-job.entity');
  const manifest = JSON.parse(
    await readFile(join(corpusRoot, 'manifest.json'), 'utf8'),
  ) as Corpus;
  const storageRoot = process.env.ESIGN_STORAGE_ROOT;
  await mkdir(join(storageRoot, 'capacity-sources'), { recursive: true });
  const sourceFiles: Array<{
    objectKey: string;
    bytes: number;
    sha256: string;
  }> = [];
  for (let i = 0; i < count; i++) {
    const c = manifest.files[i % manifest.files.length],
      objectKey = `capacity-sources/${String(i).padStart(5, '0')}.pdf`;
    await link(
      join(corpusRoot, 'corpus', c.name),
      join(storageRoot, objectKey),
    );
    sourceFiles.push({ objectKey, bytes: c.bytes, sha256: c.sha256 });
  }
  const expectedByRecord = new Map<
    number,
    { zipPath: string; bytes: number; sha256: string }
  >();
  async function seedExport(label: string) {
    const doc = await db.manager.save(
      EsignDocument,
      db.manager.create(EsignDocument, {
        docNumber: randomUUID(),
        title: `合成容量 ${label}`,
        createdByUserId: ownerUser.id,
        status: 'draft',
        watermarkEnabled: false,
        allowReject: false,
      }),
    );
    for (let start = 0; start < count; start += 500)
      await db.manager.insert(
        EsignSigner,
        Array.from({ length: Math.min(500, count - start) }, (_, j) => ({
          publicId: randomUUID(),
          documentId: doc.id,
          signerType: 'email',
          email: `capacity-${start + j}@example.test`,
          nameSnapshot: `合成-${start + j}`,
          status: 'signed',
          signedAt: new Date(),
          completionStatus: 'ready',
          completionReadyAt: new Date(),
          sortOrder: start + j,
        })),
      );
    await mkdir(join(storageRoot, `capacity-doc-${doc.id}`), {
      recursive: true,
    });
    for (let i = 0; i < count; i++)
      await link(
        join(storageRoot, sourceFiles[i].objectKey),
        join(storageRoot, `capacity-doc-${doc.id}/${i}.pdf`),
      );
    const signers = await db.manager.find(EsignSigner, {
      where: { documentId: doc.id },
      order: { sortOrder: 'ASC' },
    });
    for (let start = 0; start < count; start += 500)
      await db.manager.insert(
        EsignSignatureRecord,
        signers.slice(start, start + 500).map((s) => ({
          signerId: s.id,
          documentSha256: 'a'.repeat(64),
          signingPayloadSha256: 'b'.repeat(64),
          consentVersion: 'synthetic',
          authenticationMethod: 'synthetic',
          authenticationEventId: randomUUID(),
          signedAtUtc: new Date(),
        })),
      );
    const records = await db.manager.find(EsignSignatureRecord, {
      where: signers.map((s) => ({ signerId: s.id })),
      order: { id: 'ASC' },
    });
    for (let start = 0; start < count; start += 500)
      await db.manager.insert(
        EsignFileObject,
        records.slice(start, start + 500).map((r, j) => ({
          signatureRecordId: r.id,
          filePurpose: 'completed_pdf',
          archiveStatus: 'active',
          storageDriver: 'local',
          objectKey: `capacity-doc-${doc.id}/${start + j}.pdf`,
          mimeType: 'application/pdf',
          fileSize: sourceFiles[start + j].bytes,
          sha256: sourceFiles[start + j].sha256,
        })),
      );
    for (let i = 0; i < records.length; i++)
      expectedByRecord.set(Number(records[i].id), {
        zipPath: `副本_合成-${i}_${signers[i].publicId}.pdf`,
        bytes: sourceFiles[i].bytes,
        sha256: sourceFiles[i].sha256,
      });
    return doc.id;
  }
  const { PDFDocument } = require('pdf-lib') as typeof import('pdf-lib');
  const { esignTestPng } =
    require('../esign-test-png') as typeof import('../esign-test-png');
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const pdfBytes = Buffer.from(await pdf.save());
  const people: Array<{ cookie: string; ip: string; id: number }> = [];
  async function prepareSigning(round: string, n = 60): Promise<SignTask[]> {
    while (people.length < n) {
      const i = people.length,
        empid = `CAP${String(i).padStart(5, '0')}`;
      const person = await login(empid, i + 1);
      const [u] = await db.query<Array<{ id: number }>>(
        'SELECT id FROM users WHERE empid=?',
        [empid],
      );
      people.push({ ...person, id: u.id });
    }
    const form = new FormData();
    form.set('title', `簽署容量 ${round}`);
    form.set(
      'file',
      new Blob([pdfBytes], { type: 'application/pdf' }),
      'synthetic.pdf',
    );
    const uploaded = await fetch(base + '/api/esign/documents', {
      method: 'POST',
      headers: {
        Cookie: owner.cookie,
        Origin: origin,
        'X-Forwarded-For': owner.ip,
      },
      body: form,
    });
    const upload = (await uploaded.json()) as { data: { id: string } };
    if (!uploaded.ok) throw new Error(`upload ${uploaded.status}`);
    const active = await http<{ signers: Array<{ publicId: string }> }>(
      `/api/esign/documents/${upload.data.id}/initiations`,
      owner.cookie,
      {
        signers: people
          .slice(0, n)
          .map((p) => ({ type: 'user', userId: String(p.id) })),
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
        allowReject: false,
      },
      owner.ip,
    );
    const tasks: SignTask[] = [];
    for (let i = 0; i < n; i++) {
      const p = people[i],
        publicId = active.data.signers[i].publicId;
      const task = await http<{
        fields: Array<{ id: string }>;
        consent: { version: string };
      }>(`/api/esign/signing-tasks/${publicId}`, p.cookie, {}, p.ip);
      tasks.push({
        ...p,
        publicId,
        body: {
          requestId: randomUUID(),
          accepted: true,
          consentVersion: task.data.consent.version,
          signatures: task.data.fields.map((f) => ({
            fieldId: f.id,
            pngDataUrl:
              'data:image/png;base64,' + esignTestPng(i + 1).toString('base64'),
          })),
        },
      });
    }
    return tasks;
  }
  async function signing(tasks: SignTask[], label: string) {
    const measurements: Array<{
      start: number;
      end: number;
      ms: number;
      status: number;
    }> = [];
    let next = 0;
    await Promise.all(
      [0, 1].map(async () => {
        while (next < tasks.length) {
          const t = tasks[next++],
            start = Date.now();
          const r = await http(
            `/api/esign/signing-tasks/${t.publicId}/signatures`,
            t.cookie,
            t.body,
            t.ip,
          );
          measurements.push({
            start,
            end: Date.now(),
            ms: r.ms,
            status: r.status,
          });
        }
      }),
    );
    await writeFile(
      join(output, `signing-${label}.json`),
      JSON.stringify(measurements, null, 2),
    );
    return {
      label,
      count: measurements.length,
      p95: p95(measurements.map((m) => m.ms)),
      start: Math.min(...measurements.map((m) => m.start)),
      end: Math.max(...measurements.map((m) => m.end)),
      failures: measurements.filter((m) => m.status !== 201).length,
    };
  }
  async function settledSignatures() {
    for (let i = 0; i < 1200; i++) {
      const [pending] = await db.query<Array<{ n: number }>>(
        "SELECT COUNT(*) n FROM esign_signers WHERE signer_type='user' AND status='signed' AND completion_status<>'ready'",
      );
      if (Number(pending.n) === 0) return;
      await sleep(100);
    }
    throw new Error('簽署副本未完成，不能比較下一組');
  }
  const results: unknown[] = [];
  try {
    let child = await startWorker();
    if (mode === 'fault') {
      const doc = await seedExport('kill-worker');
      const accepted = await http<ExportView>(
        `/api/esign/documents/${doc}/exports`,
        owner.cookie,
        { type: 'signed_copies_zip' },
        owner.ip,
      );
      let before = await db.manager.findOneByOrFail(EsignExportJob, {
        publicId: accepted.data.id,
      });
      while (
        !before.stagingJson ||
        !(before.processedCount && before.processedCount > 0)
      ) {
        await sleep(20);
        before = await db.manager.findOneByOrFail(EsignExportJob, {
          publicId: accepted.data.id,
        });
        if (before.status === 'failed' || before.status === 'completed')
          throw new Error('未捕捉到 worker staging');
      }
      const killedPid = child.pid;
      child.kill('SIGKILL');
      await once(child, 'exit');
      // 縮短測試的業務租約等待；BullMQ 真實鎖到期/停滯偵測仍照原設定。
      await db.manager.update(
        EsignExportJob,
        { id: before.id },
        { leaseExpiresAt: new Date(0) },
      );
      const competingDocument = await seedExport('second-worker');
      const competing = await http<ExportView>(
        `/api/esign/documents/${competingDocument}/exports`,
        owner.cookie,
        { type: 'signed_copies_zip' },
        owner.ip,
      );
      child = await startWorker();
      const second = await startWorker();
      let final: ExportView | undefined;
      let peakProcessing = 0;
      let competingFinal: ExportView | undefined;
      for (let i = 0; i < 1200; i++) {
        const [active] = await db.query<Array<{ n: number }>>(
          "SELECT COUNT(*) n FROM esign_export_jobs WHERE status='processing'",
        );
        peakProcessing = Math.max(peakProcessing, Number(active.n));
        final = (
          await http<ExportView>(
            `/api/esign/documents/${doc}/exports/${accepted.data.id}`,
            owner.cookie,
            undefined,
            owner.ip,
          )
        ).data;
        competingFinal = (
          await http<ExportView>(
            `/api/esign/documents/${competingDocument}/exports/${competing.data.id}`,
            owner.cookie,
            undefined,
            owner.ip,
          )
        ).data;
        if (
          final.status === 'completed' &&
          competingFinal.status === 'completed'
        )
          break;
        if (competingFinal.status === 'failed')
          throw new Error('第二個工作失敗');
        if (final.status === 'failed')
          throw new Error(`重啟失敗 ${final.failureCode}`);
        await sleep(200);
      }
      if (
        final?.status !== 'completed' ||
        competingFinal?.status !== 'completed' ||
        peakProcessing > 1
      )
        throw new Error('kill recovery/global concurrency failed');
      const after = await db.manager.findOneByOrFail(EsignExportJob, {
        id: before.id,
      });
      if (
        (after.attemptCount ?? 0) < 2 ||
        after.snapshotSha256 !== before.snapshotSha256
      )
        throw new Error('recovery did not retain snapshot');
      const stored = await db.manager.findOneByOrFail(EsignFileObject, {
        exportJobId: after.id,
        filePurpose: 'signed_copies_zip',
      });
      const expectedPath = join(output, 'expected-recovery.json');
      await writeFile(
        expectedPath,
        JSON.stringify({
          entries: after.snapshotJson!.map((s) =>
            expectedByRecord.get(Number(s.recordId)),
          ),
          totalBytes: sourceFiles.reduce((n, f) => n + f.bytes, 0),
        }),
      );
      execFileSync(
        'python3',
        [
          join(__dirname, 'verify-export-zip.py'),
          join(storageRoot, stored.objectKey),
          expectedPath,
          '--require-zip64',
          '--output',
          join(output, 'verify-recovery.json'),
        ],
        { stdio: 'pipe' },
      );
      for (const suffix of ['', '.tmp']) {
        const exists = await access(
          join(storageRoot, before.stagingJson.objectKey + suffix),
        ).then(
          () => true,
          () => false,
        );
        if (exists) throw new Error('舊 generation 殘件未清除');
      }
      await writeFile(
        join(output, 'recovery.json'),
        JSON.stringify(
          {
            killedPid,
            completedEntriesBeforeKill: before.processedCount,
            competingJobCompleted: competingFinal?.status === 'completed',
            signal: 'SIGKILL',
            attempts: after.attemptCount,
            peakProcessing,
            unchangedSnapshot: true,
            oldStagingRemoved: true,
            completed: true,
            oldStaging: before.stagingJson.objectKey,
            newObject: stored.objectKey,
            businessLeaseClockAccelerated: true,
          },
          null,
          2,
        ),
      );
      await stopWorker(second);
      await stopWorker(child);
      return;
    }
    await signing(await prepareSigning('warmup', 20), 'warmup');
    await settledSignatures();
    for (const compression of count === 6000
      ? ['store', '1', '6']
      : ['store']) {
      if (compression !== 'store') {
        await stopWorker(child);
        child = await startWorker(compression);
      }
      for (
        let round = 0;
        round < (compression === 'store' && count === 6000 ? 3 : 1);
        round++
      ) {
        const label = `${compression}-${round}`,
          doc = await seedExport(label),
          baselineTasks = await prepareSigning(`baseline-${label}`),
          duringTasks = await prepareSigning(`export-${label}`);
        const baseline = await signing(baselineTasks, `baseline-${label}`);
        await settledSignatures();
        const accepted = await http<ExportView>(
            `/api/esign/documents/${doc}/exports`,
            owner.cookie,
            { type: 'signed_copies_zip' },
            owner.ip,
          ),
          jobPath = `/api/esign/documents/${doc}/exports/${accepted.data.id}`;
        let state = accepted.data;
        const began = Date.now();
        while (state.status !== 'processing' && state.status !== 'completed') {
          if (Date.now() - began > 10 * 60_000) throw new Error('匯出等待逾時');
          if (state.status === 'failed')
            throw new Error(`export failed ${state.failureCode}`);
          await sleep(100);
          state = (
            await http<ExportView>(jobPath, owner.cookie, undefined, owner.ip)
          ).data;
        }
        const processingObserved = Date.now(),
          during = await signing(duringTasks, `export-${label}`),
          afterSigning = (
            await http<ExportView>(jobPath, owner.cookie, undefined, owner.ip)
          ).data;
        while (state.status !== 'completed') {
          if (Date.now() - began > 10 * 60_000) throw new Error('匯出等待逾時');
          if (state.status === 'failed')
            throw new Error(`export failed ${state.failureCode}`);
          await sleep(500);
          state = (
            await http<ExportView>(jobPath, owner.cookie, undefined, owner.ip)
          ).data;
        }
        const ended = Date.now(),
          file = state.files[0],
          job = await db.manager.findOneByOrFail(EsignExportJob, {
            publicId: state.id,
          }),
          expected = {
            entries: job.snapshotJson!.map((s) =>
              expectedByRecord.get(Number(s.recordId)),
            ),
            totalBytes: sourceFiles.reduce((n, f) => n + f.bytes, 0),
          },
          expectedPath = join(output, `expected-${label}.json`);
        await writeFile(expectedPath, JSON.stringify(expected));
        const stored = await db.manager.findOneByOrFail(EsignFileObject, {
            exportJobId: job.id,
            filePurpose: 'signed_copies_zip',
          }),
          zipPath = join(storageRoot, stored.objectKey);
        execFileSync(
          'python3',
          [
            join(__dirname, 'verify-export-zip.py'),
            zipPath,
            expectedPath,
            '--require-zip64',
            '--output',
            join(output, `verify-${label}.json`),
          ],
          { stdio: 'pipe' },
        );
        let resumed = false;
        if (compression === 'store' && round === 0) {
          await verifyResumedDownload(
            base,
            owner.cookie,
            file,
            join(output, 'resumed.zip'),
          );
          resumed = true;
        }
        const row = {
          label,
          compression,
          count,
          acceptedMs: accepted.ms,
          acceptedStatus: accepted.status,
          processingObserved,
          ended,
          elapsedMs: ended - began,
          bytes: file.size,
          ratio: file.size / expected.totalBytes,
          baseline,
          during,
          allSigningDuringProcessing:
            afterSigning.status === 'processing' &&
            during.start >= processingObserved,
          signingP95Growth: (during.p95 / baseline.p95 - 1) * 100,
          resumed,
          zip64Verified: true,
        };
        results.push(row);
        process.stdout.write(JSON.stringify(row) + '\n');
        await writeFile(
          join(output, 'results.json'),
          JSON.stringify(results, null, 2),
        );
        await db.manager.update(
          EsignExportJob,
          { id: job.id },
          { expiresAt: new Date(0) },
        );
        await rm(zipPath);
      }
    }
    await stopWorker(child);
    if (count === 6000) {
      const rows = results as Array<{
        acceptedMs: number;
        allSigningDuringProcessing: boolean;
      }>;
      const baselineSamples: number[] = [],
        exportSamples: number[] = [];
      for (let round = 0; round < 3; round++) {
        for (const [label, target] of [
          ['baseline', baselineSamples],
          ['export', exportSamples],
        ] as const) {
          const values = JSON.parse(
            await readFile(
              join(output, `signing-${label}-store-${round}.json`),
              'utf8',
            ),
          ) as Array<{ ms: number; status: number }>;
          if (values.some((v) => v.status !== 201))
            throw new Error('簽署失敗不可排除出統計');
          target.push(...values.map((v) => v.ms));
        }
      }
      const baselineP95 = p95(baselineSamples),
        exportP95 = p95(exportSamples),
        growth = (exportP95 / baselineP95 - 1) * 100;
      const gates = {
        firstSnapshotSamples: rows.length,
        firstSnapshotP95Ms: p95(rows.map((r) => r.acceptedMs)),
        signingSamplesPerGroup: baselineSamples.length,
        baselineP95Ms: baselineP95,
        exportP95Ms: exportP95,
        signingGrowthPercent: growth,
        allDuringProcessing: rows.every((r) => r.allSigningDuringProcessing),
        acceptedWithin5s: p95(rows.map((r) => r.acceptedMs)) <= 5000,
        signingWithin20Percent: growth <= 20,
        deploymentS3: '未驗證',
      };
      await writeFile(
        join(output, 'gates.json'),
        JSON.stringify(gates, null, 2),
      );
      if (
        !gates.acceptedWithin5s ||
        !gates.signingWithin20Percent ||
        !gates.allDuringProcessing
      )
        process.exitCode = 2;
    }
  } finally {
    for (const w of workers) await stopWorker(w);
    clearInterval(timer);
    await writeFile(
      join(output, 'resources.json'),
      JSON.stringify({ api: samples, workers: childSamples }, null, 2),
    );
    await ctx.app.close();
  }
}
void (mode === 'worker' ? worker() : run()).catch((e: unknown) => {
  process.stderr.write(String(e instanceof Error ? e.stack : e) + '\n');
  for (const w of workers) w.kill('SIGTERM');
  process.exit(1);
});
