import { randomBytes } from 'node:crypto';
import { validateAppEnvironment } from './app.environment';

const encryptionKey = randomBytes(32).toString('base64');

/** staging／production 的公司 Gmail SMTP：587 埠 STARTTLS 並以帳號驗證。 */
const gmailSmtp = {
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_PORT: '587',
  SMTP_SECURE: 'false',
  SMTP_USER: 'sender@example.internal',
  SMTP_PASSWORD: 'not-a-real-app-password',
  SMTP_FROM: 'sender@example.internal',
};

describe('validateAppEnvironment', () => {
  it('development 固定使用 local storage 與 SMTP，允許不驗證、不加密的本機 Mailpit', () => {
    expect(
      validateAppEnvironment({
        NODE_ENV: 'development',
        ESIGN_STORAGE_ROOT: '/tmp/esign-development',
        EXTERNAL_SIGNING_ORIGIN: 'http://localhost:3000',
        ESIGN_INVITATION_ENCRYPTION_KEY_B64: encryptionKey,
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '1025',
        SMTP_SECURE: 'false',
        SMTP_FROM: 'no-reply@example.test',
      }),
    ).toMatchObject({
      ESIGN_STORAGE_DRIVER: 'local',
      ESIGN_MAIL_DRIVER: 'smtp',
    });
  });

  it('test 固定使用 local storage 與 fake mailer', () => {
    expect(
      validateAppEnvironment({
        NODE_ENV: 'test',
        ESIGN_STORAGE_ROOT: '/tmp/esign-test',
        EXTERNAL_SIGNING_ORIGIN: 'http://127.0.0.1:3000',
        ESIGN_INVITATION_ENCRYPTION_KEY_B64: encryptionKey,
      }),
    ).toMatchObject({
      ESIGN_STORAGE_DRIVER: 'local',
      ESIGN_MAIL_DRIVER: 'fake',
    });
  });

  it('staging 固定使用 local storage 與 SMTP', () => {
    expect(
      validateAppEnvironment({
        NODE_ENV: 'staging',
        ESIGN_STORAGE_ROOT: '/mnt/esign',
        ...gmailSmtp,
        EXTERNAL_SIGNING_ORIGIN: 'https://esign-uat.example.internal',
        ESIGN_INVITATION_ENCRYPTION_KEY_B64: encryptionKey,
      }),
    ).toMatchObject({
      ESIGN_STORAGE_DRIVER: 'local',
      ESIGN_MAIL_DRIVER: 'smtp',
    });
  });

  it('production 固定使用 S3 與 SMTP', () => {
    expect(
      validateAppEnvironment({
        NODE_ENV: 'production',
        ESIGN_S3_BUCKET: 'feastogether-esign-production',
        AWS_REGION: 'ap-northeast-1',
        ...gmailSmtp,
        EXTERNAL_SIGNING_ORIGIN: 'https://esign.example.internal',
        ESIGN_INVITATION_ENCRYPTION_KEY_B64: encryptionKey,
      }),
    ).toMatchObject({
      ESIGN_STORAGE_DRIVER: 's3',
      ESIGN_MAIL_DRIVER: 'smtp',
    });
  });

  it('production 不得降級到 local 或改用 SES', () => {
    expect(() =>
      validateAppEnvironment({
        NODE_ENV: 'production',
        ESIGN_STORAGE_DRIVER: 'local',
      }),
    ).toThrow('NODE_ENV=production');
    expect(() =>
      validateAppEnvironment({
        NODE_ENV: 'production',
        ESIGN_MAIL_DRIVER: 'ses',
      }),
    ).toThrow('NODE_ENV=production');
  });

  it.each(['staging', 'production'])(
    '%s 未設定寄信帳密時啟動失敗，並指出缺少的設定',
    (environment) => {
      const validate = (smtp: Record<string, string>) => () =>
        validateAppEnvironment({
          NODE_ENV: environment,
          ESIGN_STORAGE_ROOT: '/mnt/esign',
          ESIGN_S3_BUCKET: 'feastogether-esign-production',
          AWS_REGION: 'ap-northeast-1',
          ...gmailSmtp,
          ...smtp,
          EXTERNAL_SIGNING_ORIGIN: 'https://esign.example.internal',
          ESIGN_INVITATION_ENCRYPTION_KEY_B64: encryptionKey,
        });

      expect(validate({ SMTP_USER: '', SMTP_PASSWORD: '' })).toThrow(
        '環境變數 SMTP_USER 為必填',
      );
      expect(validate({ SMTP_PASSWORD: '' })).toThrow(
        '環境變數 SMTP_PASSWORD 為必填',
      );
    },
  );

  it('staging 與 production 不接受 AWS access key 環境變數', () => {
    expect(() =>
      validateAppEnvironment({
        NODE_ENV: 'staging',
        ESIGN_STORAGE_ROOT: '/mnt/esign',
        ...gmailSmtp,
        AWS_ACCESS_KEY_ID: 'not-a-real-key',
        EXTERNAL_SIGNING_ORIGIN: 'https://esign-uat.example.internal',
        ESIGN_INVITATION_ENCRYPTION_KEY_B64: encryptionKey,
      }),
    ).toThrow('AWS_ACCESS_KEY_ID');
  });

  it('拒絕相對 storage root 與錯誤長度加密金鑰', () => {
    expect(() =>
      validateAppEnvironment({
        NODE_ENV: 'test',
        ESIGN_STORAGE_ROOT: './private',
        EXTERNAL_SIGNING_ORIGIN: 'http://localhost:3000',
        ESIGN_INVITATION_ENCRYPTION_KEY_B64: encryptionKey,
      }),
    ).toThrow('絕對路徑');

    expect(() =>
      validateAppEnvironment({
        NODE_ENV: 'test',
        ESIGN_STORAGE_ROOT: '/tmp/esign-test',
        EXTERNAL_SIGNING_ORIGIN: 'http://localhost:3000',
        ESIGN_INVITATION_ENCRYPTION_KEY_B64: 'dG9vLXNob3J0',
      }),
    ).toThrow('32 bytes');
  });

  it('回傳去除空白後的 EXTERNAL_SIGNING_ORIGIN，避免驗證網址帶入空白', () => {
    expect(
      validateAppEnvironment({
        NODE_ENV: 'test',
        ESIGN_STORAGE_ROOT: '/tmp/esign-test',
        EXTERNAL_SIGNING_ORIGIN: ' http://localhost:3000\n',
        ESIGN_INVITATION_ENCRYPTION_KEY_B64: encryptionKey,
      }).EXTERNAL_SIGNING_ORIGIN,
    ).toBe('http://localhost:3000');
  });
});
