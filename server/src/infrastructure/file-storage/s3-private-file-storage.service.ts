import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
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

type S3Sender = Pick<S3Client, 'send'>;

@Injectable()
export class S3PrivateFileStorage implements PrivateFileStorage {
  constructor(
    private readonly bucket: string,
    private readonly client: S3Sender,
  ) {
    if (bucket.trim() === '') {
      throw new Error('ESIGN_S3_BUCKET 為必填');
    }
  }

  async store(input: StorePrivateFileInput): Promise<StoredPrivateFile> {
    const objectKey = createPrivateObjectKey(input.directory, input.extension);
    const bytes = Buffer.from(input.bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: bytes,
        ContentType: input.mimeType,
        IfNoneMatch: '*',
        Metadata: { sha256 },
      }),
    );

    return {
      objectKey,
      ...(result.VersionId ? { objectVersion: result.VersionId } : {}),
      mimeType: input.mimeType,
      fileSize: bytes.byteLength,
      sha256,
    };
  }

  async openReadStream(reference: PrivateFileReference): Promise<Readable> {
    assertPrivateObjectKey(reference.objectKey);
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: reference.objectKey,
        ...(reference.objectVersion
          ? { VersionId: reference.objectVersion }
          : {}),
      }),
    );
    if (!(result.Body instanceof Readable)) {
      throw new Error('S3 未回傳可讀取的私有檔案 stream');
    }
    return result.Body;
  }

  async delete(reference: PrivateFileReference): Promise<void> {
    assertPrivateObjectKey(reference.objectKey);
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: reference.objectKey,
        ...(reference.objectVersion
          ? { VersionId: reference.objectVersion }
          : {}),
      }),
    );
  }
}
