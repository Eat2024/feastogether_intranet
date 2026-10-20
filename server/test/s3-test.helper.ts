import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  S3Client,
  CreateBucketCommand,
  PutBucketVersioningCommand,
} from '@aws-sdk/client-s3';
import { S3PrivateFileStorage } from '#app/infrastructure/file-storage/s3-private-file-storage.service';

/** 測試限定 loopback Moto；不使用 credential provider chain 或正式雲端帳號。 */
export async function startTestS3() {
  const listener = createServer();
  await new Promise<void>((resolve) =>
    listener.listen(0, '127.0.0.1', resolve),
  );
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const server = spawn('moto_server', ['-H', '127.0.0.1', '-p', String(port)], {
    stdio: 'ignore',
  });
  const endpoint = `http://127.0.0.1:${port}`;
  let launchError: Error | undefined;
  server.on('error', (error) => {
    launchError = error;
  });
  const client = new S3Client({
    endpoint,
    forcePathStyle: true,
    region: 'us-east-1',
    credentials: {
      accessKeyId: 'test-local-only',
      secretAccessKey: 'test-local-only',
    },
  });
  const close = async () => {
    client.destroy();
    if (server.pid && server.exitCode === null) {
      const stopped = new Promise<void>((resolve) =>
        server.once('exit', () => resolve()),
      );
      server.kill();
      await stopped;
    }
  };
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (launchError) throw launchError;
      try {
        await fetch(endpoint);
        break;
      } catch {
        await delay(100);
      }
    }
    const bucket = `esign-test-${randomUUID()}`;
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    await client.send(
      new PutBucketVersioningCommand({
        Bucket: bucket,
        VersioningConfiguration: { Status: 'Enabled' },
      }),
    );
    return {
      client,
      bucket,
      storage: new S3PrivateFileStorage(bucket, client),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
export type TestS3 = Awaited<ReturnType<typeof startTestS3>>;
