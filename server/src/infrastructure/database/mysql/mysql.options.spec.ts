import { buildMysqlOptions } from './mysql.options';

describe('buildMysqlOptions', () => {
  const values: Readonly<Record<string, string>> = {
    DB_MYSQL_HOST: 'mysql.internal',
    DB_MYSQL_PORT: '3307',
    DB_MYSQL_USER: 'app',
    DB_MYSQL_PASS: 'secret',
    DB_MYSQL_DB: 'app_db',
    DB_MYSQL_POOL_MAX: '23',
  };
  const readEnv = (key: string): string | undefined => values[key];

  it('使用 mysql driver 與 DB_MYSQL_* 設定', () => {
    const options = buildMysqlOptions(readEnv);

    expect(options).toMatchObject({
      type: 'mysql',
      host: 'mysql.internal',
      port: 3307,
      username: 'app',
      password: 'secret',
      database: 'app_db',
      charset: 'utf8mb4',
      synchronize: false,
    });
  });

  it('連線固定 UTC 並套用 pool 上限', () => {
    const options = buildMysqlOptions(readEnv);

    expect(options.extra).toMatchObject({
      connectionLimit: 23,
      timezone: '+00:00',
      supportBigNumbers: true,
      bigNumberStrings: false,
    });
  });

  it('Auth 尚未啟用時不註冊 entity 或 migration', () => {
    const options = buildMysqlOptions(readEnv);

    expect(options.entities).toEqual([]);
    expect(options.migrations).toEqual([]);
  });

  it('未設定 SSL env 時不帶 ssl 選項', () => {
    const options = buildMysqlOptions(readEnv);

    expect('ssl' in options).toBe(false);
  });

  it('DB_MYSQL_SSL_CA_B64 解回 PEM 作為 ssl.ca', () => {
    const pem = '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----\n';
    const options = buildMysqlOptions((key) =>
      key === 'DB_MYSQL_SSL_CA_B64'
        ? Buffer.from(pem, 'utf8').toString('base64')
        : values[key],
    );

    expect(options).toMatchObject({ ssl: { ca: pem } });
  });

  it('DB_MYSQL_SSL=true 啟用 TLS（系統 CA）、skip-verify 不驗憑證', () => {
    const withMode = (mode: string) =>
      buildMysqlOptions((key) => (key === 'DB_MYSQL_SSL' ? mode : values[key]));

    expect(withMode('true')).toMatchObject({ ssl: {} });
    expect(withMode('skip-verify')).toMatchObject({
      ssl: { rejectUnauthorized: false },
    });
  });

  it('不讀取舊 DB_MARIADB_*', () => {
    const legacyValues: Readonly<Record<string, string>> = {
      DB_MARIADB_HOST: 'legacy.internal',
      DB_MARIADB_PORT: '3310',
      DB_MARIADB_USER: 'legacy',
      DB_MARIADB_PASS: 'legacy',
      DB_MARIADB_DB: 'legacy',
    };

    const options = buildMysqlOptions((key) => legacyValues[key]);

    expect(options).toMatchObject({
      host: '127.0.0.1',
      port: 3306,
      username: 'root',
      password: '',
      database: 'feastogether_intranet',
    });
  });
});
