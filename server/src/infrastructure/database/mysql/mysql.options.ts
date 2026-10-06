// mysql.options.ts
// 連線設定單一事實來源：app provider 與 migration CLI 共用，避免兩邊漂移。
// Nest runtime 由 provider 傳入 ConfigService 讀取器；CLI/seed 直接 import 時才 fallback 到 process.env。
import type { DataSourceOptions } from 'typeorm';

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

    // Auth/RBAC/Audit 尚未啟用：保留 entity 與 migration 原始碼，但不交給
    // runtime 或 TypeORM CLI 載入，避免此階段建立 auth 相關資料表。
    entities: [],
    migrations: [],

    extra: {
      connectionLimit: Number(env(readEnv, 'DB_MYSQL_POOL_MAX', '10')),
      supportBigNumbers: true,
      bigNumberStrings: false,
      timezone: '+00:00',
    },
  };
}
