import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalPrivateFileStorage } from './local-private-file-storage.service';

describe('LocalPrivateFileStorage', () => {
  let root: string;
  let storage: LocalPrivateFileStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'esign-storage-'));
    storage = new LocalPrivateFileStorage(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('以隨機 key、原子 rename 保存並回傳 persisted bytes metadata', async () => {
    const bytes = Buffer.from('private pdf');
    const first = await storage.store({
      directory: 'documents/doc-1/source',
      extension: 'pdf',
      mimeType: 'application/pdf',
      bytes,
    });
    const second = await storage.store({
      directory: 'documents/doc-1/source',
      extension: 'pdf',
      mimeType: 'application/pdf',
      bytes,
    });

    expect(first.objectKey).not.toBe(second.objectKey);
    expect(first).toMatchObject({
      fileSize: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      mimeType: 'application/pdf',
    });
    expect(await readFile(join(root, first.objectKey))).toEqual(bytes);
    expect(
      (await readdir(join(root, 'documents/doc-1/source'))).some((name) =>
        name.endsWith('.tmp'),
      ),
    ).toBe(false);
  });

  it('stream read 後可冪等刪除 orphan', async () => {
    const stored = await storage.store({
      directory: 'documents/doc-1/signatures/signer-1/field-1',
      extension: 'png',
      mimeType: 'image/png',
      bytes: Buffer.from('png'),
    });
    const stream = await storage.openReadStream(stored);
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('png');

    await storage.delete(stored);
    await expect(storage.delete(stored)).resolves.toBeUndefined();
  });

  it('串流保存 ZIP 並依 bytes 範圍續傳，中止不發布半包', async () => {
    const stored = await storage.storeStream({
      directory: 'exports/job-1/generation-1',
      extension: 'zip',
      mimeType: 'application/zip',
      stream: Readable.from([Buffer.from('hello'), Buffer.from(' world')]),
    });
    expect(stored.fileSize).toBe(11);
    expect(stored.sha256).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    );
    const stream = await storage.openReadStream(stored, { start: 6, end: 10 });
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('world');
    const signal = AbortSignal.abort();
    await expect(
      storage.storeStream({
        directory: 'exports/job-1/generation-2',
        extension: 'zip',
        mimeType: 'application/zip',
        stream: Readable.from(['partial']),
        signal,
      }),
    ).rejects.toThrow();
    expect(await readdir(join(root, 'exports/job-1/generation-2'))).toEqual([]);
    expect(await readFile(join(root, stored.objectKey), 'utf8')).toBe(
      'hello world',
    );
  });

  it('來源中斷不發布 ZIP，也不刪除其他來源檔', async () => {
    const original = await storage.store({
      directory: 'documents/source',
      extension: 'pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from('source'),
    });
    const stream = Readable.from(
      (async function* () {
        yield Buffer.from('partial');
        throw new Error('合成來源中斷');
      })(),
    );
    await expect(
      storage.storeStream({
        directory: 'exports/failure/generation',
        extension: 'zip',
        mimeType: 'application/zip',
        stream,
      }),
    ).rejects.toThrow('合成來源中斷');
    expect(await readdir(join(root, 'exports/failure/generation'))).toEqual([]);
    expect(await readFile(join(root, original.objectKey), 'utf8')).toBe(
      'source',
    );
  });

  it('目的端目錄不可寫入時中止來源串流，保留既有檔案', async () => {
    await writeFile(join(root, 'exports'), 'existing');
    const stream = Readable.from(['partial']);
    await expect(
      storage.storeStream({
        directory: 'exports/job',
        extension: 'zip',
        mimeType: 'application/zip',
        stream,
      }),
    ).rejects.toThrow();
    expect(stream.destroyed).toBe(true);
    expect(await readFile(join(root, 'exports'), 'utf8')).toBe('existing');
  });

  it('拒絕 traversal 與不安全的 logical directory', async () => {
    await expect(
      storage.openReadStream({ objectKey: '../outside.pdf' }),
    ).rejects.toThrow('object key');
    await expect(
      storage.store({
        directory: 'documents/../outside',
        extension: 'pdf',
        mimeType: 'application/pdf',
        bytes: Buffer.from('x'),
      }),
    ).rejects.toThrow('目錄格式');
  });
});
