import type { Readable } from 'node:stream';

export const PRIVATE_FILE_STORAGE = Symbol('PRIVATE_FILE_STORAGE');

export interface StorePrivateFileInput {
  directory: string;
  extension: 'pdf' | 'png';
  mimeType: 'application/pdf' | 'image/png';
  bytes: Uint8Array;
}

export interface StorePrivateStreamInput {
  directory: string;
  extension: 'zip';
  mimeType: 'application/zip';
  stream: Readable;
  signal?: AbortSignal;
  /** 容量／multipart partSize 預估，並非精確 ContentLength；禁止當作 HTTP Content-Length。 */
  expectedSize?: number;
  /** 在資料開始寫入前保存 generation 物件位置，供中斷後清理。 */
  onStaging?: (
    reference: PrivateFileReference & { uploadId?: string },
  ) => Promise<void>;
}

export interface ReadPrivateFileOptions {
  start?: number;
  end?: number;
  signal?: AbortSignal;
}

export interface StoredPrivateFile {
  objectKey: string;
  objectVersion?: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
}

export interface PrivateFileReference {
  objectKey: string;
  objectVersion?: string;
}

export interface PrivateFileStorage {
  store(input: StorePrivateFileInput): Promise<StoredPrivateFile>;
  storeStream?(input: StorePrivateStreamInput): Promise<StoredPrivateFile>;
  openReadStream(
    reference: PrivateFileReference,
    options?: ReadPrivateFileOptions,
  ): Promise<Readable>;
  stat?(reference: PrivateFileReference): Promise<{ fileSize: number }>;
  cleanupExports?(
    before: Date,
    limit: number,
    isReferenced?: (reference: PrivateFileReference) => Promise<boolean>,
  ): Promise<void>;
  delete(reference: PrivateFileReference): Promise<void>;
}
