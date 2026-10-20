import { isAbsolute } from 'node:path';

/** 應用程式支援的執行環境名稱，對應 NODE_ENV。 */
export enum AppEnvironment {
  Development = 'development',
  Test = 'test',
  Staging = 'staging',
  Production = 'production',
}

export type EsignStorageDriver = 'local' | 's3';
export type EsignMailDriver = 'fake' | 'smtp';

type Environment = Record<string, unknown>;

/** staging／production 為對外部署環境：寄信須驗證且加密、不接受 AWS access key。 */
export function isDeployedEnvironment(environment: unknown): boolean {
  return (
    environment === AppEnvironment.Staging ||
    environment === AppEnvironment.Production
  );
}

const EXPECTED_ESIGN_DRIVERS: Record<
  AppEnvironment,
  { storage: EsignStorageDriver; mail: EsignMailDriver }
> = {
  [AppEnvironment.Development]: { storage: 'local', mail: 'smtp' },
  [AppEnvironment.Test]: { storage: 'local', mail: 'fake' },
  [AppEnvironment.Staging]: { storage: 'local', mail: 'smtp' },
  [AppEnvironment.Production]: { storage: 's3', mail: 'smtp' },
};

function requiredString(config: Environment, key: string): string {
  const value = config[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`環境變數 ${key} 為必填`);
  }
  return value.trim();
}

function optionalString(config: Environment, key: string): string | undefined {
  const value = config[key];
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined;
}

function validateExternalOrigin(value: string, environment: AppEnvironment): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('環境變數 EXTERNAL_SIGNING_ORIGIN 必須是有效 origin');
  }

  const isLocalHttp =
    (environment === AppEnvironment.Development ||
      environment === AppEnvironment.Test) &&
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1');

  if (
    (url.protocol !== 'https:' && !isLocalHttp) ||
    url.origin !== value ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new Error(
      '環境變數 EXTERNAL_SIGNING_ORIGIN 必須是固定 HTTPS origin（本機可用 localhost HTTP）',
    );
  }
}

function validateEncryptionKey(value: string): void {
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 32) {
    throw new Error(
      '環境變數 ESIGN_INVITATION_ENCRYPTION_KEY_B64 必須是 32 bytes 的 base64',
    );
  }
}

function validateMailAddress(value: string, key: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error(`環境變數 ${key} 必須是有效 Email`);
  }
}

/**
 * 驗證電子簽部署矩陣並回傳正規化設定。
 *
 * Driver 只能依 NODE_ENV 選擇，避免 production 因設定錯誤降級到本機檔案或 fake mailer。
 */
export function validateAppEnvironment(config: Environment): Environment {
  const environment = (optionalString(config, 'NODE_ENV') ??
    AppEnvironment.Development) as AppEnvironment;

  if (!Object.values(AppEnvironment).includes(environment)) {
    throw new Error(`不支援的 NODE_ENV：${environment}`);
  }

  const expected = EXPECTED_ESIGN_DRIVERS[environment];
  const storageDriver = (optionalString(config, 'ESIGN_STORAGE_DRIVER') ??
    expected.storage) as EsignStorageDriver;
  const mailDriver = (optionalString(config, 'ESIGN_MAIL_DRIVER') ??
    expected.mail) as EsignMailDriver;

  if (storageDriver !== expected.storage || mailDriver !== expected.mail) {
    throw new Error(
      `NODE_ENV=${environment} 必須使用 ESIGN_STORAGE_DRIVER=${expected.storage}、ESIGN_MAIL_DRIVER=${expected.mail}`,
    );
  }

  if (storageDriver === 'local') {
    const storageRoot = requiredString(config, 'ESIGN_STORAGE_ROOT');
    if (!isAbsolute(storageRoot)) {
      throw new Error('環境變數 ESIGN_STORAGE_ROOT 必須是絕對路徑');
    }
  } else {
    requiredString(config, 'ESIGN_S3_BUCKET');
    requiredString(config, 'AWS_REGION');
  }

  if (mailDriver === 'smtp') {
    requiredString(config, 'SMTP_HOST');
    const port = Number(requiredString(config, 'SMTP_PORT'));
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error('環境變數 SMTP_PORT 必須是 1–65535 的整數');
    }
    const secure = requiredString(config, 'SMTP_SECURE');
    if (secure !== 'true' && secure !== 'false') {
      throw new Error('環境變數 SMTP_SECURE 必須是 true 或 false');
    }
    validateMailAddress(requiredString(config, 'SMTP_FROM'), 'SMTP_FROM');

    // 部署環境一律以帳號驗證寄信；連線加密由 SMTP adapter 依環境強制
    if (isDeployedEnvironment(environment)) {
      requiredString(config, 'SMTP_USER');
      requiredString(config, 'SMTP_PASSWORD');
    }
    const user = optionalString(config, 'SMTP_USER');
    const password = optionalString(config, 'SMTP_PASSWORD');
    if ((user === undefined) !== (password === undefined)) {
      throw new Error('SMTP_USER 與 SMTP_PASSWORD 必須同時設定或同時省略');
    }
  }

  if (isDeployedEnvironment(environment)) {
    for (const key of [
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_SESSION_TOKEN',
    ]) {
      if (optionalString(config, key) !== undefined) {
        throw new Error(
          `${environment} 不接受 ${key}，請使用 runtime IAM role`,
        );
      }
    }
  }

  const externalOrigin = requiredString(config, 'EXTERNAL_SIGNING_ORIGIN');
  validateExternalOrigin(externalOrigin, environment);
  validateEncryptionKey(
    requiredString(config, 'ESIGN_INVITATION_ENCRYPTION_KEY_B64'),
  );

  return {
    ...config,
    NODE_ENV: environment,
    ESIGN_STORAGE_DRIVER: storageDriver,
    ESIGN_MAIL_DRIVER: mailDriver,
    // 驗證網址會印進完成 PDF，必須使用去除空白後的 origin
    EXTERNAL_SIGNING_ORIGIN: externalOrigin,
  };
}
