// 只解析 Compose，不啟動容器、不讀取主機機密。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intranet-rds-compose-'));
try {
  const password = 'synthetic$VALUE#with!special';
  fs.writeFileSync(path.join(dir, 'server.env'), 'DB_MYSQL_HOST=mysql\nDB_MYSQL_USER=intranet_app\nDB_MYSQL_PASS=old-password\nSMTP_PASSWORD=synthetic-smtp\n');
  fs.writeFileSync(path.join(dir, 'migration.env'), [
    'DB_MYSQL_HOST=ftg2-00-test-rds-cluster.cluster-cheguogu8mzk.ap-east-2.rds.amazonaws.com',
    'DB_MYSQL_PORT=3306',
    'DB_MYSQL_DB=intranet_uat',
    'DB_MYSQL_USER=feasteng',
    `DB_MYSQL_PASS=${password}`,
    `DB_MYSQL_SSL_CA_B64=${Buffer.from('synthetic-ca').toString('base64')}`,
    '',
  ].join('\n'));
  const compose = fs.readFileSync(path.join(__dirname, '../../docker-compose.uat.yml'), 'utf8')
    .replaceAll('/home/feasteng/deploy/intranet-uat/', `${dir}/`);
  fs.writeFileSync(path.join(dir, 'compose.yml'), compose);
  const result = JSON.parse(execFileSync('docker', [
    'compose', '--env-file', '/dev/null', '-f', path.join(dir, 'compose.yml'),
    '--profile', 'tools', 'config', '--format', 'json',
  ], {
    env: { ...process.env, CLIENT_IMAGE: 'example/client:test', SERVER_IMAGE: 'example/server:test' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
  assert.equal(result.name, 'intranet-uat');
  assert.equal(result.services.mysql, undefined);
  assert.equal(result.volumes['mysql-data'], undefined);
  for (const name of ['server', 'worker', 'db-backup']) {
    const env = result.services[name].environment;
    assert.equal(env.DB_MYSQL_HOST, 'ftg2-00-test-rds-cluster.cluster-cheguogu8mzk.ap-east-2.rds.amazonaws.com');
    assert.equal(env.DB_MYSQL_DB, 'intranet_uat');
    assert.equal(env.DB_MYSQL_USER, 'feasteng');
    // Compose config 序列化時會將 $ 轉為 $$，以便再次載入。
    assert.equal(env.DB_MYSQL_PASS.replaceAll("$$", "$"), password);
    assert.equal(env.DB_MYSQL_SSL_CA_B64, Buffer.from('synthetic-ca').toString('base64'));
    assert.equal(result.services[name].ports, undefined);
  }
  assert.equal(result.services.server.environment.SMTP_PASSWORD, 'synthetic-smtp');
  assert.equal(result.services.worker.healthcheck.disable, true);
  assert.match(result.services['db-backup'].command[0], /--ssl-mode=VERIFY_IDENTITY/);
  assert.match(result.services['db-backup'].command[0], /--ssl-ca=/);
  assert.equal(result.volumes['esign-data'].name, 'intranet-uat_esign-data');
  assert.equal(result.volumes['redis-data'].name, 'intranet-uat_redis-data');
  assert.equal(result.networks.default.name, 'intranet-uat_default');
  assert.equal(result.networks.default.external, true);
  console.log('RDS Compose 測試通過：raw 密碼、覆蓋舊 DB、共用 CA、隔離備份與既有 volumes。');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
