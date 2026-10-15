import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
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
