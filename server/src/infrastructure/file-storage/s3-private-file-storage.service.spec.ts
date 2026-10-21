import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { S3PrivateFileStorage } from './s3-private-file-storage.service';

describe('S3PrivateFileStorage', () => {
  it('以 private put 保存且保留 VersionId，不產生公開 URL', async () => {
    const send = jest.fn().mockResolvedValue({ VersionId: 'version-1' });
    const storage = new S3PrivateFileStorage('private-bucket', {
      send,
    } as unknown as S3Client);

    const result = await storage.store({
      directory: 'documents/doc-1/source',
      extension: 'pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from('pdf'),
    });

    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(PutObjectCommand);
    const input = (send.mock.calls[0]?.[0] as PutObjectCommand).input;
    expect(input).toMatchObject({
      Bucket: 'private-bucket',
      Key: result.objectKey,
      ContentType: 'application/pdf',
      IfNoneMatch: '*',
    });
    expect(input).not.toHaveProperty('ACL');
    expect(result.objectVersion).toBe('version-1');
    expect(result).not.toHaveProperty('url');
  });

  it('stream read/delete 都帶入 object version', async () => {
    const body = Readable.from(Buffer.from('pdf'));
    const send = jest
      .fn()
      .mockResolvedValueOnce({ Body: body })
      .mockResolvedValueOnce({});
    const storage = new S3PrivateFileStorage('private-bucket', {
      send,
    } as unknown as S3Client);
    const reference = {
      objectKey: 'documents/doc-1/source/file.pdf',
      objectVersion: 'version-1',
    };

    await expect(storage.openReadStream(reference)).resolves.toBe(body);
    await storage.delete(reference);

    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);
    expect((send.mock.calls[0]?.[0] as GetObjectCommand).input).toMatchObject({
      VersionId: 'version-1',
    });
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(DeleteObjectCommand);
    expect(
      (send.mock.calls[1]?.[0] as DeleteObjectCommand).input,
    ).toMatchObject({ VersionId: 'version-1' });
  });

  it('Range 讀取指定版本且 HEAD 回傳實際大小，取消訊號傳到 S3', async () => {
    const body = Readable.from(Buffer.from('bc'));
    const send = jest
      .fn()
      .mockResolvedValueOnce({ Body: body })
      .mockResolvedValueOnce({ ContentLength: 3 });
    const storage = new S3PrivateFileStorage('private-bucket', {
      send,
    } as unknown as S3Client);
    const signal = new AbortController().signal;
    const reference = {
      objectKey: 'exports/job/generation.zip',
      objectVersion: 'v1',
    };
    await expect(
      storage.openReadStream(reference, { start: 1, end: 2, signal }),
    ).resolves.toBe(body);
    expect(send.mock.calls[0][0].input).toMatchObject({
      Range: 'bytes=1-2',
      VersionId: 'v1',
    });
    expect(send.mock.calls[0][1]).toEqual({ abortSignal: signal });
    await expect(storage.stat(reference)).resolves.toEqual({ fileSize: 3 });
    expect(send.mock.calls[1][0].input).toMatchObject({ VersionId: 'v1' });
  });

  it('S3/IAM 失敗直接 fail closed', async () => {
    const storage = new S3PrivateFileStorage('private-bucket', {
      send: jest.fn().mockRejectedValue(new Error('AccessDenied')),
    } as unknown as S3Client);

    await expect(
      storage.store({
        directory: 'documents/doc-1/source',
        extension: 'pdf',
        mimeType: 'application/pdf',
        bytes: Buffer.from('pdf'),
      }),
    ).rejects.toThrow('AccessDenied');
  });
});
