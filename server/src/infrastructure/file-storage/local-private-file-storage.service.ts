import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, type ReadStream } from 'node:fs';
import { mkdir, rename, rm, writeFile, stat, opendir } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import {
  type PrivateFileReference,
  type StorePrivateStreamInput,
  type ReadPrivateFileOptions,
  type PrivateFileStorage,
  type StoredPrivateFile,
  type StorePrivateFileInput,
} from './private-file-storage.port';
import {
  assertPrivateObjectKey,
  createPrivateObjectKey,
} from './private-file-key';

@Injectable()
export class LocalPrivateFileStorage implements PrivateFileStorage {
  private readonly root: string;

  constructor(root: string) {
    if (!isAbsolute(root)) {
      throw new Error('ESIGN_STORAGE_ROOT 必須是絕對路徑');
    }
    this.root = resolve(root);
  }

  async store(input: StorePrivateFileInput): Promise<StoredPrivateFile> {
    const objectKey = createPrivateObjectKey(input.directory, input.extension);
    const target = this.resolveObjectKey(objectKey);
    const temporary = `${target}.${randomUUID()}.tmp`;
    const bytes = Buffer.from(input.bytes);

    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    try {
      await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }

    return {
      objectKey,
      mimeType: input.mimeType,
      fileSize: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }

  async storeStream(
    input: StorePrivateStreamInput,
  ): Promise<StoredPrivateFile> {
    const objectKey = createPrivateObjectKey(input.directory, input.extension);
    const target = this.resolveObjectKey(objectKey);
    const temporary = `${target}.tmp`;
    const hash = createHash('sha256');
    let fileSize = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        fileSize += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await input.onStaging?.({ objectKey });
      await pipeline(
        input.stream,
        meter,
        createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
        { signal: input.signal },
      );
      input.signal?.throwIfAborted();
      await rename(temporary, target);
      return {
        objectKey,
        mimeType: input.mimeType,
        fileSize,
        sha256: hash.digest('hex'),
      };
    } catch (error) {
      input.stream.destroy();
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async stat(reference: PrivateFileReference): Promise<{ fileSize: number }> {
    const info = await stat(this.resolveObjectKey(reference.objectKey));
    if (!info.isFile()) throw new Error('私有物件不是檔案');
    return { fileSize: info.size };
  }

  async openReadStream(
    reference: PrivateFileReference,
    options: ReadPrivateFileOptions = {},
  ): Promise<ReadStream> {
    const path = this.resolveObjectKey(reference.objectKey);
    await stat(path);
    return createReadStream(path, options);
  }

  private exportSweep?: AsyncGenerator<string>;
  /** 每次最多檢查 limit 個 entry；延續游標以免大量歷史目錄讓後段殘件飢餓。 */
  async cleanupExports(
    before: Date,
    limit: number,
    isReferenced?: (reference: PrivateFileReference) => Promise<boolean>,
  ): Promise<void> {
    this.exportSweep ??= this.walkExports(resolve(this.root, 'exports'));
    for (let index = 0; index < limit; index++) {
      const entry = await this.exportSweep.next();
      if (entry.done) {
        this.exportSweep = undefined;
        break;
      }
      const path = entry.value;
      const info = await stat(path).catch(() => null);
      if (!info?.isFile() || info.mtime >= before) continue;
      const objectKey = relative(this.root, path);
      if (
        path.endsWith('.tmp') ||
        (path.endsWith('.zip') &&
          isReferenced &&
          !(await isReferenced({ objectKey })))
      )
        await rm(path, { force: true });
    }
  }
  private async *walkExports(directory: string): AsyncGenerator<string> {
    const dir = await opendir(directory).catch(() => null);
    if (!dir) return;
    for await (const entry of dir) {
      const path = resolve(directory, entry.name);
      yield path;
      if (entry.isDirectory()) yield* this.walkExports(path);
    }
  }
  async onModuleDestroy(): Promise<void> {
    await this.exportSweep?.return(undefined);
  }

  async delete(reference: PrivateFileReference): Promise<void> {
    const path = this.resolveObjectKey(reference.objectKey);
    await rm(path, { force: true });
    if (reference.objectKey.startsWith('exports/'))
      await rm(`${path}.tmp`, { force: true });
  }

  private resolveObjectKey(objectKey: string): string {
    assertPrivateObjectKey(objectKey);
    const target = resolve(this.root, objectKey);
    const pathFromRoot = relative(this.root, target);
    if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
      throw new Error('私有檔案 object key 超出 storage root');
    }
    return target;
  }
}
