import type { Readable } from 'node:stream';

export const PRIVATE_FILE_STORAGE = Symbol('PRIVATE_FILE_STORAGE');

export interface StorePrivateFileInput {
  directory: string;
  extension: 'pdf' | 'png';
  mimeType: 'application/pdf' | 'image/png';
  bytes: Uint8Array;
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
  openReadStream(reference: PrivateFileReference): Promise<Readable>;
  delete(reference: PrivateFileReference): Promise<void>;
}
