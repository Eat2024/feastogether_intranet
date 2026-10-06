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
