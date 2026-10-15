import type {
  PrivateFileReference,
  PrivateFileStorage,
} from './private-file-storage.port';

export async function readPrivateFile(
  storage: PrivateFileStorage,
  reference: PrivateFileReference,
): Promise<Buffer> {
  const stream = await storage.openReadStream(reference);
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<unknown>) {
    if (typeof chunk === 'string' || chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
      continue;
    }
    throw new Error('私有檔案 stream 回傳無效資料');
  }
  return Buffer.concat(chunks);
}
