import { getMetadataArgsStorage } from 'typeorm';
import { EsignNotificationBatch } from './esign-notification-batch.entity';
import { EsignNotificationLog } from './esign-notification-log.entity';

it('催簽持久化可保存請求防重、每日額度與獨立憑證', () => {
  const metadata = getMetadataArgsStorage();
  expect(
    metadata.columns
      .filter((c) => c.target === EsignNotificationBatch)
      .map((c) => c.propertyName),
  ).toEqual(
    expect.arrayContaining([
      'publicId',
      'kind',
      'requestId',
      'requestPayloadSha256',
    ]),
  );
  expect(
    metadata.columns
      .filter((c) => c.target === EsignNotificationLog)
      .map((c) => c.propertyName),
  ).toEqual(
    expect.arrayContaining([
      'dispatchDate',
      'leaseToken',
      'attemptHistoryJson',
      'reminderTokenSha256',
      'reminderTokenCiphertext',
      'invitationGenerationSha256',
      'reminderExpiresAt',
    ]),
  );
});
