import { startTestS3, type TestS3 } from './s3-test.helper';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  S3Client,
  CreateBucketCommand,
  PutBucketVersioningCommand,
  ListMultipartUploadsCommand,
  ListPartsCommand,
  CreateMultipartUploadCommand,
  PutObjectCommand,
  ListObjectVersionsCommand,
  CompleteMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { S3PrivateFileStorage } from '#app/infrastructure/file-storage/s3-private-file-storage.service';

jest.setTimeout(60_000);

/** 真 HTTP 測試；PATH 需有隔離安裝的 moto_server，不讀正式憑證或帳號。 */
describe('S3 adapter 真 HTTP 串流', () => {
  let testS3: TestS3;
  let client: S3Client;
  let storage: S3PrivateFileStorage;
  let bucket: string;
  beforeAll(async () => {
    testS3 = await startTestS3();
    ({ client, bucket, storage } = testS3);
  });
  afterAll(async () => {
    await testS3?.close();
  });

  it('未啟用或暫停版本控制不得發布 ZIP，清除無固定版本的成果', async () => {
    const unversioned = `${bucket}-unversioned`;
    await client.send(new CreateBucketCommand({ Bucket: unversioned }));
    const unsafeStorage = new S3PrivateFileStorage(unversioned, client);
    for (const suspended of [false, true]) {
      if (suspended) {
        await client.send(
          new PutBucketVersioningCommand({
            Bucket: unversioned,
            VersioningConfiguration: { Status: 'Enabled' },
          }),
        );
        await client.send(
          new PutBucketVersioningCommand({
            Bucket: unversioned,
            VersioningConfiguration: { Status: 'Suspended' },
          }),
        );
      }
      await expect(
        unsafeStorage.storeStream({
          directory: 'exports/unversioned/generation',
          extension: 'zip',
          mimeType: 'application/zip',
          stream: Readable.from([Buffer.from('unsafe-zip')]),
        }),
      ).rejects.toThrow('S3 ZIP 匯出需要有效的固定 VersionId');
      const remaining = await client.send(
        new ListObjectVersionsCommand({
          Bucket: unversioned,
          Prefix: 'exports/',
        }),
      );
      expect(remaining.Versions ?? []).toHaveLength(0);
      expect(remaining.DeleteMarkers ?? []).toHaveLength(0);
    }
  });

  it('同 key 同長度覆寫後仍讀取原固定版本，缺少版本的舊成果不可讀', async () => {
    const result = await storage.storeStream({
      directory: 'exports/pinned/generation',
      extension: 'zip',
      mimeType: 'application/zip',
      stream: Readable.from([Buffer.from('original')]),
    });
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: result.objectKey,
        Body: 'replaced',
      }),
    );
    const stream = await storage.openReadStream(result);
    let body = '';
    for await (const chunk of stream) body += String(chunk);
    expect(body).toBe('original');
    for (const objectVersion of [undefined, 'null']) {
      const reference = { objectKey: result.objectKey, objectVersion };
      await expect(storage.stat(reference)).rejects.toThrow(
        'S3 ZIP 匯出需要有效的固定 VersionId',
      );
      await expect(storage.openReadStream(reference)).rejects.toThrow(
        'S3 ZIP 匯出需要有效的固定 VersionId',
      );
    }
    await storage.delete({ objectKey: result.objectKey });
  });

  it('未知長度串流先記錄 generation/uploadId，再傳 multipart；HEAD、Range、實際 hash 與版本可讀', async () => {
    const chunk = Buffer.alloc(1024 * 1024, 0x61);
    let read = false;
    const stages: string[] = [];
    const result = await storage.storeStream({
      directory: 'exports/job/generation',
      extension: 'zip',
      mimeType: 'application/zip',
      expectedSize: 1,
      stream: Readable.from(
        (function* () {
          read = true;
          for (let i = 0; i < 33; i++) yield chunk;
        })(),
      ),
      onStaging: async (reference) => {
        stages.push(reference.uploadId ?? 'generation');
        if (!reference.uploadId) expect(read).toBe(false);
        else {
          const parts = await client.send(
            new ListPartsCommand({
              Bucket: bucket,
              Key: reference.objectKey,
              UploadId: reference.uploadId,
            }),
          );
          expect(parts.Parts ?? []).toHaveLength(0);
        }
      },
    });
    expect(stages).toHaveLength(2);
    expect(result.fileSize).toBe(33 * 1024 * 1024);
    const hash = createHash('sha256');
    for (let i = 0; i < 33; i++) hash.update(chunk);
    expect(result.sha256).toBe(hash.digest('hex'));
    expect(result.objectVersion).toBeTruthy();
    await expect(storage.stat(result)).resolves.toEqual({
      fileSize: 33 * 1024 * 1024,
    });
    const range = await storage.openReadStream(result, {
      start: 16 * 1024 * 1024 - 1,
      end: 16 * 1024 * 1024 + 1,
    });
    const bytes: Buffer[] = [];
    for await (const part of range) {
      if (!Buffer.isBuffer(part)) throw new Error('預期二進位 S3 stream');
      bytes.push(part);
    }
    expect(Buffer.concat(bytes).toString()).toBe('aaa');
    expect(
      (await client.send(new ListMultipartUploadsCommand({ Bucket: bucket })))
        .Uploads ?? [],
    ).toHaveLength(0);
    await storage.delete(result);
    await expect(storage.stat(result)).rejects.toThrow();
  });
  it('小於一個 part 的成果與空串流可完成，保持實際長度而非預估長度', async () => {
    for (const bytes of [Buffer.from('abc'), Buffer.alloc(0)]) {
      const result = await storage.storeStream({
        directory: 'exports/small/generation',
        extension: 'zip',
        mimeType: 'application/zip',
        stream: Readable.from([bytes]),
        expectedSize: 99,
      });
      await expect(storage.stat(result)).resolves.toEqual({
        fileSize: bytes.length,
      });
      expect(result.sha256).toBe(
        createHash('sha256').update(bytes).digest('hex'),
      );
      if (bytes.length) {
        const range = await storage.openReadStream(result, { end: 1 });
        let text = '';
        for await (const part of range) text += String(part);
        expect(text).toBe('ab');
      }
      await storage.delete(result);
    }
  });

  it('來源中斷、外部取消、持久化 uploadId 失敗都不留下可下載物件或 MPU', async () => {
    for (const mode of ['source', 'abort', 'staging']) {
      const controller = new AbortController();
      const stream = Readable.from(
        (async function* () {
          for (let i = 0; i < 17; i++) yield Buffer.alloc(1024 * 1024, 0x61);
          await delay(30);
          if (mode === 'source') throw new Error('source-failed');
          yield Buffer.alloc(1024);
        })(),
      );
      await expect(
        storage.storeStream({
          directory: `exports/${mode}/generation`,
          extension: 'zip',
          mimeType: 'application/zip',
          stream,
          signal: controller.signal,
          onStaging: (reference) => {
            if (reference.uploadId && mode === 'abort') controller.abort();
            if (reference.uploadId && mode === 'staging')
              throw new Error('database-failed');
            return Promise.resolve();
          },
        }),
      ).rejects.toThrow();
      expect(stream.destroyed).toBe(true);
      expect(
        (await client.send(new ListMultipartUploadsCommand({ Bucket: bucket })))
          .Uploads ?? [],
      ).toHaveLength(0);
      expect(
        (
          await client.send(
            new ListObjectVersionsCommand({
              Bucket: bucket,
              Prefix: `exports/${mode}/`,
            }),
          )
        ).Versions ?? [],
      ).toHaveLength(0);
    }
  });

  it('complete 遭 S3 拒絕不發布半包，等待在飛 part 後 abort', async () => {
    // 真 HTTP 傳 part，僅故障注入遠端 complete 邊界。
    const failingClient = Object.create(client) as S3Client;
    failingClient.send = (async (command: Parameters<S3Client['send']>[0]) => {
      if (command instanceof CompleteMultipartUploadCommand)
        throw new Error('S3-complete-unavailable');
      return client.send(command);
    }) as S3Client['send'];
    const failingStorage = new S3PrivateFileStorage(bucket, failingClient);
    await expect(
      failingStorage.storeStream({
        directory: 'exports/complete-failure/generation',
        extension: 'zip',
        mimeType: 'application/zip',
        stream: Readable.from(
          (function* () {
            for (let i = 0; i < 18; i++) yield Buffer.alloc(1024 * 1024);
          })(),
        ),
      }),
    ).rejects.toThrow('S3-complete-unavailable');
    expect(
      (await client.send(new ListMultipartUploadsCommand({ Bucket: bucket })))
        .Uploads ?? [],
    ).toHaveLength(0);
    expect(
      (
        await client.send(
          new ListObjectVersionsCommand({
            Bucket: bucket,
            Prefix: 'exports/complete-failure/',
          }),
        )
      ).Versions ?? [],
    ).toHaveLength(0);
  });

  it('complete 已成立但回應遺失時不發布成果，清掉遠端物件與 MPU', async () => {
    const uncertainClient = Object.create(client) as S3Client;
    uncertainClient.send = (async (
      command: Parameters<S3Client['send']>[0],
    ) => {
      const result = await client.send(command);
      if (command instanceof CompleteMultipartUploadCommand)
        throw new Error('complete-response-lost');
      return result;
    }) as S3Client['send'];
    const uncertainStorage = new S3PrivateFileStorage(bucket, uncertainClient);
    await expect(
      uncertainStorage.storeStream({
        directory: 'exports/unknown-complete/generation',
        extension: 'zip',
        mimeType: 'application/zip',
        stream: Readable.from(
          (function* () {
            for (let i = 0; i < 18; i++) yield Buffer.alloc(1024 * 1024);
          })(),
        ),
      }),
    ).rejects.toThrow('complete-response-lost');
    const remaining = await client.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: 'exports/unknown-complete/',
      }),
    );
    expect(remaining.Versions ?? []).toHaveLength(0);
    expect(remaining.DeleteMarkers ?? []).toHaveLength(0);
    expect(
      (await client.send(new ListMultipartUploadsCommand({ Bucket: bucket })))
        .Uploads ?? [],
    ).toHaveLength(0);
  });

  it('staging 只知道 key/uploadId 仍可刪除完成前後的殘留，且不留下 delete marker', async () => {
    const key = 'exports/crash/generation.zip';
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: 'orphan-version',
      }),
    );
    const upload = await client.send(
      new CreateMultipartUploadCommand({ Bucket: bucket, Key: key }),
    );
    await storage.delete({ objectKey: key, uploadId: upload.UploadId });
    const objects = await client.send(
      new ListObjectVersionsCommand({ Bucket: bucket, Prefix: key }),
    );
    expect(objects.Versions ?? []).toHaveLength(0);
    expect(objects.DeleteMarkers ?? []).toHaveLength(0);
    expect(
      (await client.send(new ListMultipartUploadsCommand({ Bucket: bucket })))
        .Uploads ?? [],
    ).toHaveLength(0);
  });

  it('有界分頁清理會越過仍引用的第一頁，移除舊版本及 MPU，保護來源與 active generation', async () => {
    const protectedKey = 'exports/cleanup/a-active.zip';
    const abandonedKey = 'exports/cleanup/z-abandoned.zip';
    const sourceKey = 'documents/source.pdf';
    for (const key of [protectedKey, abandonedKey, sourceKey])
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: 'fixture' }),
      );
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: abandonedKey,
        Body: 'another-version',
      }),
    );
    await client.send(
      new CreateMultipartUploadCommand({ Bucket: bucket, Key: protectedKey }),
    );
    await client.send(
      new CreateMultipartUploadCommand({ Bucket: bucket, Key: abandonedKey }),
    );
    const before = new Date(Date.now() + 60_000);
    for (let i = 0; i < 8; i++)
      await storage.cleanupExports(before, 1, (reference) =>
        Promise.resolve(reference.objectKey === protectedKey),
      );
    const remaining = await client.send(
      new ListObjectVersionsCommand({ Bucket: bucket }),
    );
    expect(remaining.Versions?.map((v) => v.Key).sort()).toEqual(
      [sourceKey, protectedKey].sort(),
    );
    expect(remaining.DeleteMarkers ?? []).toHaveLength(0);
    expect(
      (
        await client.send(new ListMultipartUploadsCommand({ Bucket: bucket }))
      ).Uploads?.map((v) => v.Key),
    ).toEqual([protectedKey]);
  });
});
