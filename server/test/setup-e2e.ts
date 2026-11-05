// e2e 專用 jest setupFiles(033 環境隔離;research 詳見 specs/033-e2e-redis-isolation/)。
//
// ## 為什麼要 patch supertest
//
// supertest 的 `Test#serverAddress` 對未監聽的 server 執行 `app.listen(0)`——綁的是
// wildcard(`::` dual-stack)。macOS 的臨時埠配發**不排除**已被其他 process 以
// specific bind 佔住的埠(實測 3000 次 listen(0) 會拿到被佔埠 1 次),此時 supertest
// 連 `http://127.0.0.1:P` 會被 kernel 路由給「更 specific」的外來 listener,測試收到
// 裸 403/404 或非 HTTP bytes 而機率性失敗。
//
// 2026-09-02 取證(docs/e2e-flakiness-report-2026-09-02.md 結案章節):每一筆失敗埠號
// 都對上本機應用的 loopback listener——49157=Antigravity language server(HTTPS,回
// "Client sent an HTTP request to an HTTPS server.")、49200/49215=Antigravity IDE(裸
// 404)、59410=LINE(非 HTTP bytes → "Parse Error: Expected HTTP/")。CI 乾淨 runner
// 無這些應用,故只咬開發機。
//
// ## 修法:URL 改走 IPv6 loopback
//
// 維持原本**同步**的 wildcard listen(supertest 在建構式同步讀 address,不能改成
// 非同步綁定),但把回傳 URL 的 host 從 `127.0.0.1` 改為 `[::1]`:squatter 都是 IPv4
// specific bind,IPv6 側最 specific 的 listener 就是我們自己的 `::` dual-stack server
// (極端情境實測:LINE 佔 127.0.0.1:59410 時,自綁 :59410 成功且 [::1]:59410 連回自己)。
// 已自行綁 IPv4 的 server(family 非 IPv6,如 socket suite 的 `listen(0,'127.0.0.1')`)
// 不改寫。
//
// ⚠️ 曾試過改成 `app.listen(0, '127.0.0.1')`(specific bind 不會被配到被佔埠):
// **已證偽,勿再嘗試**——帶 host 的 listen 走 dns.lookup 路徑、bind 非同步,supertest
// 同步讀 address() 得 null 後會再補一次 wildcard listen,等於沒修。
//
// 迴歸鎖:test/e2e-env-isolation.e2e-spec.ts「supertest 埠號防撞」兩測試。
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-require-imports */
const SupertestTest: any = require('supertest/lib/test');
const {
  generateKeyPairSync,
  randomUUID,
}: typeof import('node:crypto') = require('node:crypto');

{
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.WEBVIEW_JWT_ISSUER = 'e2e-main-platform';
  process.env.WEBVIEW_JWT_AUDIENCE = 'e2e-esign';
  process.env.WEBVIEW_LAUNCH_ORIGIN = 'http://localhost:3001';
  process.env.WEBVIEW_JWT_PUBLIC_KEY_B64 = Buffer.from(
    pair.publicKey.export({ type: 'spki', format: 'pem' }),
  ).toString('base64');
  process.env.WEBVIEW_TEST_PRIVATE_KEY_B64 = Buffer.from(
    pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  ).toString('base64');
}
process.env.CORS_ORIGIN ??= 'http://localhost:3000';
process.env.AUTH_TRUSTED_ORIGINS ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.ESIGN_STORAGE_DRIVER ??= 'local';
process.env.ESIGN_STORAGE_ROOT ??= '/tmp/feastogether-intranet-esign-test';
process.env.ESIGN_MAIL_DRIVER ??= 'fake';
process.env.EXTERNAL_SIGNING_ORIGIN ??= 'http://localhost:3000';
process.env.ESIGN_INVITATION_ENCRYPTION_KEY_B64 ??= Buffer.alloc(
  32,
  'e2e',
).toString('base64');

// Spec 024：Portal 連線一律指向本測試檔專屬的合成 Portal 資料庫（由 test/synthetic-portal.helper.ts 建立）。
// 必須在 AppModule 載入前無條件覆寫：ConfigModule 載入時把當下的 process.env 與 server/.env 存成驗證後設定，
// 之後再改 process.env 不會生效；在這裡覆寫，.env 中的真實 Portal 設定才不會被 e2e 讀到。
// 隨機碼只取 8 碼：MySQL 資料庫名稱上限 64 字元，worktree 的 DB_MYSQL_DB 已經比較長。
process.env.PORTAL_MYSQL_HOST = process.env.DB_MYSQL_HOST ?? '127.0.0.1';
process.env.PORTAL_MYSQL_PORT = process.env.DB_MYSQL_PORT ?? '3306';
process.env.PORTAL_MYSQL_USER = process.env.DB_MYSQL_USER ?? 'root';
process.env.PORTAL_MYSQL_PASS = process.env.DB_MYSQL_PASS ?? '';
process.env.PORTAL_MYSQL_DB = `${process.env.DB_MYSQL_DB ?? ''}_portal_${randomUUID().slice(0, 8)}`;

// Spec 027：Super user 帳密一律用合成值無條件覆寫（理由同上，避免 e2e 讀到 server/.env 的部署設定）。
// 雜湊由 hashSuperUserPassword('e2e-synthetic-super-user-password') 預先產生，省去每個測試檔的 scrypt。
process.env.SUPER_USER_ACCOUNT = 'e2e-super-user';
process.env.SUPER_USER_PASSWORD_HASH =
  'scrypt:32768:8:1:Qoiw1lp7rrqrAsxJvF0Sng:RS3An7MhDJuWOkZ84pECGYfX6DGzyCVDYfCq-M533MmnvmVcjLIJOejPr2L_TprI_Zz7WhYPKMg5g53kH3s5BA';

const originalServerAddress = SupertestTest.prototype.serverAddress;
SupertestTest.prototype.serverAddress = function serverAddressV6Loopback(
  app: any,
  path: string,
): string {
  const url: string = originalServerAddress.call(this, app, path);
  const addr = app.address();
  if (addr && addr.family === 'IPv6') {
    return url.replace('http://127.0.0.1:', 'http://[::1]:');
  }
  return url;
};
