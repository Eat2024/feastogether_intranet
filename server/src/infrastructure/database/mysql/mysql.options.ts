// mysql.options.ts
// 連線設定單一事實來源：app provider 與 migration CLI 共用，避免兩邊漂移。
// Nest runtime 由 provider 傳入 ConfigService 讀取器；CLI/seed 直接 import 時才 fallback 到 process.env。
import type { DataSourceOptions } from 'typeorm';
import { Department } from '#app/features/users/entities/department.entity';
import { User } from '#app/features/users/entities/user.entity';
import { AuthSession } from '#app/features/auth/entities/auth-session.entity';
import { EsignAuditEvent } from '#app/features/esign/entities/esign-audit-event.entity';
import { EsignDocumentField } from '#app/features/esign/entities/esign-document-field.entity';
import { EsignDocument } from '#app/features/esign/entities/esign-document.entity';
import { EsignExportJob } from '#app/features/esign/entities/esign-export-job.entity';
import { EsignFileObject } from '#app/features/esign/entities/esign-file-object.entity';
import { EsignNotificationBatch } from '#app/features/esign/entities/esign-notification-batch.entity';
import { EsignNotificationLog } from '#app/features/esign/entities/esign-notification-log.entity';
import { EsignSignatureRecord } from '#app/features/esign/entities/esign-signature-record.entity';
import { EsignSigner } from '#app/features/esign/entities/esign-signer.entity';
import { EsignVerificationRecord } from '#app/features/esign/entities/esign-verification-record.entity';
import { InitialEsignSchema1791763200000 } from '#app/infrastructure/database/migrations/1791763200000-InitialEsignSchema';
import { CreateAuthSessions1791849600000 } from '#app/infrastructure/database/migrations/1791849600000-CreateAuthSessions';

export type EnvReader = (key: string) => string | undefined;

const processEnvReader: EnvReader = (key: string): string | undefined =>
  process.env[key];

const env = (readEnv: EnvReader, key: string, fallback: string): string =>
  readEnv(key) ?? fallback;

/**
 * TLS 設定（Aurora require_secure_transport=ON 環境必須）：
 *   - DB_MYSQL_SSL_CA_B64：base64 的 CA bundle PEM（RDS 用
 *     https://truststore.pki.rds.amazonaws.com/<region>/<region>-bundle.pem；
 *     mysql2 內建 'Amazon RDS' profile 不含 ap-east-2 等新 region，故自帶 CA）。
 *   - DB_MYSQL_SSL=true：啟用 TLS 走系統 CA。
 *   - DB_MYSQL_SSL=skip-verify：啟用 TLS 但不驗憑證（僅限無法取得 CA 的過渡期）。
 *   - 皆未設定：不啟用（本機 dev/test 現況）。
 */
function buildSslOptions(
  readEnv: EnvReader,
): { ca: string } | { rejectUnauthorized: false } | object | undefined {
  const caB64 = env(readEnv, 'DB_MYSQL_SSL_CA_B64', '');
  if (caB64) return { ca: Buffer.from(caB64, 'base64').toString('utf8') };
  const mode = env(readEnv, 'DB_MYSQL_SSL', '');
  if (mode === 'skip-verify') return { rejectUnauthorized: false };
  if (mode === 'true' || mode === '1') return {};
  return undefined;
}

export function buildMysqlOptions(
  readEnv: EnvReader = processEnvReader,
): DataSourceOptions {
  const ssl = buildSslOptions(readEnv);
  return {
    ...(ssl ? { ssl } : {}),
    type: 'mysql',
    host: env(readEnv, 'DB_MYSQL_HOST', '127.0.0.1'),
    port: Number(env(readEnv, 'DB_MYSQL_PORT', '3306')),
    username: env(readEnv, 'DB_MYSQL_USER', 'root'),
    password: env(readEnv, 'DB_MYSQL_PASS', ''),
    database: env(readEnv, 'DB_MYSQL_DB', 'feastogether_intranet'),

    // 一律以 migration 管理 schema（憲章技術約束）；prod 絕不開 synchronize。
    synchronize: false,
    logging: false,
    charset: 'utf8mb4',

    entities: [
      Department,
      User,
      AuthSession,
      EsignDocument,
      EsignDocumentField,
      EsignSigner,
      EsignSignatureRecord,
      EsignFileObject,
      EsignAuditEvent,
      EsignVerificationRecord,
      EsignNotificationBatch,
      EsignNotificationLog,
      EsignExportJob,
    ],
    migrations: [
      InitialEsignSchema1791763200000,
      CreateAuthSessions1791849600000,
    ],

    extra: {
      connectionLimit: Number(env(readEnv, 'DB_MYSQL_POOL_MAX', '10')),
      supportBigNumbers: true,
      bigNumberStrings: false,
      timezone: '+00:00',
    },
  };
}
