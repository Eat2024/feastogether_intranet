import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Upload } from '@aws-sdk/lib-storage';
import {
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListObjectVersionsCommand,
  ListMultipartUploadsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import {
  type PrivateFileReference,
  type ReadPrivateFileOptions,
  type StorePrivateStreamInput,
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
  private objectCursor?: { KeyMarker?: string; VersionIdMarker?: string };
  private uploadCursor?: { KeyMarker?: string; UploadIdMarker?: string };
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

  async storeStream(
    input: StorePrivateStreamInput,
  ): Promise<StoredPrivateFile> {
    if (!input.directory.startsWith('exports/'))
      throw new Error('串流匯出必須使用 exports 目錄');
    const objectKey = createPrivateObjectKey(input.directory, input.extension);
    const partSize = Math.max(
      16 * 1024 * 1024,
      Math.ceil((input.expectedSize ?? 0) / 10000),
    );
    if (!Number.isSafeInteger(partSize) || partSize > 5 * 1024 ** 3)
      throw new Error('匯出大小超過 S3 multipart 限制');
    const controller = new AbortController();
    const cancel = () => controller.abort(input.signal?.reason);
    if (input.signal?.aborted) cancel();
    input.signal?.addEventListener('abort', cancel, { once: true });
    let uploadId: string | undefined;
    let fileSize = 0;
    const hash = createHash('sha256');
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        fileSize += chunk.length;
        if (fileSize > partSize * 10000) {
          done(new Error('匯出大小超過 S3 multipart part 數限制'));
          return;
        }
        hash.update(chunk);
        done(null, chunk);
      },
    });
    // lib-storage 只需 SDK client config/send。攔截遠端 MPU 建立結果，先持久化 uploadId 才允許傳 part。
    const uploadClient = Object.create(this.client) as S3Client;
    uploadClient.send = (async (command: Parameters<S3Client['send']>[0]) => {
      const result = await this.client.send(command, {
        abortSignal: controller.signal,
      });
      if (command instanceof CreateMultipartUploadCommand) {
        uploadId = (result as { UploadId?: string }).UploadId;
        if (!uploadId) throw new Error('S3 未回傳 multipart uploadId');
        await input.onStaging?.({ objectKey, uploadId });
      }
      return result;
    }) as S3Client['send'];
    try {
      controller.signal.throwIfAborted();
      await input.onStaging?.({ objectKey });
      const upload = new Upload({
        client: uploadClient,
        params: {
          Bucket: this.bucket,
          Key: objectKey,
          Body: meter,
          ContentType: input.mimeType,
        },
        queueSize: 2,
        partSize,
        leavePartsOnError: true,
      });
      const transfer = upload.done().catch((error: unknown) => {
        controller.abort(error);
        throw error;
      });
      const feed = pipeline(input.stream, meter, {
        signal: controller.signal,
      }).catch((error: unknown) => {
        controller.abort(error);
        throw error;
      });
      // 等在飛的 part 全部停止才清理；Upload.abort 的 race 可能提早返回，因此取消交給 SDK HTTP signal 與 pipeline。
      const [uploaded, streamed] = await Promise.allSettled([transfer, feed]);
      if (uploaded.status === 'rejected') throw uploaded.reason;
      if (streamed.status === 'rejected') throw streamed.reason;
      // 未版本化與 suspended bucket 的 null version 可被同 key 覆寫，不得發布為固定成果。
      assertExportVersion({
        objectKey,
        objectVersion: uploaded.value.VersionId,
      });
      return {
        objectKey,
        objectVersion: uploaded.value.VersionId,
        mimeType: input.mimeType,
        fileSize,
        sha256: hash.digest('hex'),
      };
    } catch (error) {
      input.stream.destroy();
      meter.destroy();
      // 包含 complete 已成功但回應遺失的情況；generation key 唯一，可移除其所有版本。
      await this.delete({ objectKey, uploadId });
      throw error;
    } finally {
      input.signal?.removeEventListener('abort', cancel);
    }
  }

  async openReadStream(
    reference: PrivateFileReference,
    options: ReadPrivateFileOptions = {},
  ): Promise<Readable> {
    assertPrivateObjectKey(reference.objectKey);
    assertExportVersion(reference);
    const result = await this.client.send(
      new GetObjectCommand({
        ...(options.start !== undefined || options.end !== undefined
          ? { Range: `bytes=${options.start ?? 0}-${options.end ?? ''}` }
          : {}),
        Bucket: this.bucket,
        Key: reference.objectKey,
        ...(reference.objectVersion
          ? { VersionId: reference.objectVersion }
          : {}),
      }),
      { abortSignal: options.signal },
    );
    if (!(result.Body instanceof Readable)) {
      throw new Error('S3 未回傳可讀取的私有檔案 stream');
    }
    return result.Body;
  }

  async stat(reference: PrivateFileReference): Promise<{ fileSize: number }> {
    assertPrivateObjectKey(reference.objectKey);
    assertExportVersion(reference);
    const result = await this.client.send(
      new HeadObjectCommand({
        Bucket: this.bucket,
        Key: reference.objectKey,
        VersionId: reference.objectVersion,
      }),
    );
    if (
      !Number.isSafeInteger(result.ContentLength) ||
      result.ContentLength! < 0
    )
      throw new Error('S3 未回傳有效檔案大小');
    return { fileSize: result.ContentLength! };
  }

  async cleanupExports(
    before: Date,
    limit: number,
    isReferenced?: (reference: PrivateFileReference) => Promise<boolean>,
  ): Promise<void> {
    // 沒有業務引用判斷時不刪除。每次最多掃兩個有界頁面；保留游標避免第一頁 active 物件餓死後頁。
    if (!isReferenced || limit < 1) return;
    const pageSize = Math.min(Math.floor(limit), 1000);
    const objects = await this.client.send(
      new ListObjectVersionsCommand({
        Bucket: this.bucket,
        Prefix: 'exports/',
        MaxKeys: pageSize,
        ...this.objectCursor,
      }),
    );
    for (const object of [
      ...(objects.Versions ?? []),
      ...(objects.DeleteMarkers ?? []),
    ]) {
      if (!object.Key || !object.LastModified || object.LastModified >= before)
        continue;
      const reference = {
        objectKey: object.Key,
        objectVersion: object.VersionId,
      };
      if (!(await isReferenced(reference)))
        await this.client.send(
          new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: object.Key,
            VersionId: object.VersionId,
          }),
        );
    }
    this.objectCursor = objects.IsTruncated
      ? {
          KeyMarker: objects.NextKeyMarker,
          VersionIdMarker: objects.NextVersionIdMarker,
        }
      : undefined;
    const uploads = await this.client.send(
      new ListMultipartUploadsCommand({
        Bucket: this.bucket,
        Prefix: 'exports/',
        MaxUploads: pageSize,
        ...this.uploadCursor,
      }),
    );
    for (const upload of uploads.Uploads ?? []) {
      if (
        !upload.Key ||
        !upload.UploadId ||
        !upload.Initiated ||
        upload.Initiated >= before
      )
        continue;
      if (!(await isReferenced({ objectKey: upload.Key })))
        await this.abortMultipart(upload.Key, upload.UploadId);
    }
    this.uploadCursor = uploads.IsTruncated
      ? {
          KeyMarker: uploads.NextKeyMarker,
          UploadIdMarker: uploads.NextUploadIdMarker,
        }
      : undefined;
  }

  private async abortMultipart(
    objectKey: string,
    uploadId: string,
  ): Promise<void> {
    await this.client
      .send(
        new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: objectKey,
          UploadId: uploadId,
        }),
      )
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== 'NoSuchUpload') throw error;
      });
  }

  async delete(reference: PrivateFileReference): Promise<void> {
    assertPrivateObjectKey(reference.objectKey);
    if (reference.uploadId)
      await this.abortMultipart(reference.objectKey, reference.uploadId);
    if (
      reference.objectKey.startsWith('exports/') &&
      !reference.objectVersion
    ) {
      // 唯一 generation 在 complete 後、版本寫回前 crash：清掉該 key 所有版本，不能只新增 delete marker。
      let cursor: { KeyMarker?: string; VersionIdMarker?: string } | undefined;
      do {
        const page = await this.client.send(
          new ListObjectVersionsCommand({
            Bucket: this.bucket,
            Prefix: reference.objectKey,
            ...cursor,
          }),
        );
        for (const version of [
          ...(page.Versions ?? []),
          ...(page.DeleteMarkers ?? []),
        ]) {
          if (version.Key === reference.objectKey)
            await this.client.send(
              new DeleteObjectCommand({
                Bucket: this.bucket,
                Key: reference.objectKey,
                VersionId: version.VersionId,
              }),
            );
        }
        cursor = page.IsTruncated
          ? {
              KeyMarker: page.NextKeyMarker,
              VersionIdMarker: page.NextVersionIdMarker,
            }
          : undefined;
      } while (cursor);
      return;
    }
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

/** PDF 舊儲存行為不變；只有 ZIP 成果必須持有不可變的 S3 版本。 */
function assertExportVersion(reference: PrivateFileReference): void {
  if (
    reference.objectKey.startsWith('exports/') &&
    (!reference.objectVersion?.trim() || reference.objectVersion === 'null')
  )
    throw new Error('S3 ZIP 匯出需要有效的固定 VersionId');
}
