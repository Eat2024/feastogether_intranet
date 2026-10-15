import { randomUUID } from 'node:crypto';

const DIRECTORY_PATTERN = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;

export function createPrivateObjectKey(
  directory: string,
  extension: 'pdf' | 'png',
): string {
  if (!DIRECTORY_PATTERN.test(directory)) {
    throw new Error('私有檔案目錄格式無效');
  }
  return `${directory}/${randomUUID()}.${extension}`;
}

export function assertPrivateObjectKey(objectKey: string): void {
  if (
    objectKey.startsWith('/') ||
    objectKey.includes('\\') ||
    objectKey.split('/').some((segment) => segment === '..' || segment === '.')
  ) {
    throw new Error('私有檔案 object key 格式無效');
  }
}
