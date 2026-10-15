import { ConfigService } from '@nestjs/config';
import { createPrivateFileStorage } from './file-storage.module';
import { LocalPrivateFileStorage } from './local-private-file-storage.service';
import { S3PrivateFileStorage } from './s3-private-file-storage.service';

describe('FileStorageModule', () => {
  const config = (values: Record<string, string>) =>
    new ConfigService(values, { skipProcessEnv: true });

  it('local driver 只建立 local adapter', () => {
    expect(
      createPrivateFileStorage(
        config({
          ESIGN_STORAGE_DRIVER: 'local',
          ESIGN_STORAGE_ROOT: '/tmp/esign-test',
        }),
      ),
    ).toBeInstanceOf(LocalPrivateFileStorage);
  });

  it('s3 driver 只建立 S3 adapter', () => {
    expect(
      createPrivateFileStorage(
        config({
          ESIGN_STORAGE_DRIVER: 's3',
          ESIGN_S3_BUCKET: 'private-bucket',
          AWS_REGION: 'ap-northeast-1',
        }),
      ),
    ).toBeInstanceOf(S3PrivateFileStorage);
  });

  it('未知 driver 不 fallback', () => {
    expect(() =>
      createPrivateFileStorage(config({ ESIGN_STORAGE_DRIVER: 'unknown' })),
    ).toThrow('ESIGN_STORAGE_DRIVER');
  });
});
