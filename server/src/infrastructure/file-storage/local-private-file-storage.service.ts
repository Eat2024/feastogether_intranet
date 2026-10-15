import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import {
  type PrivateFileReference,
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

  openReadStream(reference: PrivateFileReference): Promise<ReadStream> {
    try {
      return Promise.resolve(
        createReadStream(this.resolveObjectKey(reference.objectKey)),
      );
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error('私有檔案讀取失敗'),
      );
    }
  }

  async delete(reference: PrivateFileReference): Promise<void> {
    await rm(this.resolveObjectKey(reference.objectKey), { force: true });
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
