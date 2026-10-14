import { S3Client } from '@aws-sdk/client-s3';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalPrivateFileStorage } from './local-private-file-storage.service';
import { PRIVATE_FILE_STORAGE } from './private-file-storage.port';
import { S3PrivateFileStorage } from './s3-private-file-storage.service';

export function createPrivateFileStorage(config: ConfigService) {
  const driver = config.get<string>('ESIGN_STORAGE_DRIVER');
  if (driver === 'local') {
    return new LocalPrivateFileStorage(
      config.getOrThrow<string>('ESIGN_STORAGE_ROOT'),
    );
  }
  if (driver === 's3') {
    return new S3PrivateFileStorage(
      config.getOrThrow<string>('ESIGN_S3_BUCKET'),
      new S3Client({ region: config.getOrThrow<string>('AWS_REGION') }),
    );
  }
  throw new Error('ESIGN_STORAGE_DRIVER 必須是 local 或 s3');
}

@Module({
  providers: [
    {
      provide: PRIVATE_FILE_STORAGE,
      inject: [ConfigService],
      useFactory: createPrivateFileStorage,
    },
  ],
  exports: [PRIVATE_FILE_STORAGE],
})
export class FileStorageModule {}
