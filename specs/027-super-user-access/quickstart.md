# Quickstart：Spec 027 實作後驗證指南

本文件描述實作完成後要執行的流程。各 ticket 實際執行的驗證只記在文末「驗收記錄」；1～6 節仍是待執行流程，不是已通過的測試紀錄。

## 前置

- 使用現有pnpm workspace與Node >=24.22.1，MySQL／Redis可用；整合測試只用 `feastogether_intranet_test*`，保留既有fail-closed防護。
- 按 [operations](contracts/operations.md) 產生專用密碼hash並填測試／本機設定；不要把帳密或入口原值寫進測試快照、PR或log。
- OAuth／WebView fixtures沿現有測試，外部OAuth成功流程使用現有受控測試環境；本plan未操作上游。
- DB migration先在隔離空庫及帶既有員工session／文件關聯的測試庫執行；正式環境不得照抄測試命令。

## 建置與自動驗證

```bash
pnpm -C server lint:check
pnpm -C server test --runInBand
pnpm -C server build
pnpm -C server test:e2e
pnpm -C server test:e2e:security
pnpm -C server test:schema
pnpm -C client lint
pnpm -C client build
pnpm build
pnpm lint
```

root lint可能包含server自動修正，執行前確認工作目錄；不能藉此覆蓋其他任務變更。client無test script，不宣稱跑過client自動測試。跨package變更需root build/lint；無外部服務時明確列出未執行項。

## 1. 初始化與登入（US1、US3）

實作後啟動：

```bash
pnpm -C server repl:dev
```

REPL依序 `await auth.initialize()`、`await auth.credentialStatus()`、`await auth.currentEntry()`。首次一列／一組初始化事件；再次initialize不換網址、不改版本。以同源瀏覽器開回傳path、輸入帳密；成功顯示Super user、cookie為HttpOnly。登入後URL回 `/`，頁面不殘留密碼。

測試錯密碼、未知帳號、無效／舊入口、超限、8KiB超限、缺Origin／跨站、缺trusted IP、Redis不可用、DB不可用。預期狀態見 [API契約](contracts/api-behavior.md)；錯密碼不撤原員工會話，不將登入401當成全站員工過期。

## 2. 會話相容與替換（US2）

- OAuth與WebView同員編取得同一本地user，user欄位仍可供EmbedBridge比對。
- employee→super→employee雙向切換；保存舊cookie僅在測試記憶體，直接重放應401。另一瀏覽器獨立會話不受影響。
- 同一有效舊cookie同時提交兩次登入，只有一次成功，另一409且無Set-Cookie；新session與舊revoked關聯一致。
- KDF／OAuth／Portal失敗或DB rollback不得撤原會話；commit後網路丟失重新登入，不回復舊token。
- 共用cookie正式環境SameSite=None+Secure，本機Lax；八小時不滑動。iframe舊流程仍可用。
- Super user session不依賴users列；user:null、actor.kind明確。員工業務在028前403，不能用任何假員工ID。
- 登出清目前cookie、撤session，不恢復舊身分。移除的POST auth/login及dev入口不得發session。

## 3. 入口輪換與並發（US3）

以測試注入時間（不新增production時間env）覆蓋週一03:59:59／04:00、跨年、停機兩週。worker job與startup catch-up並發，entryGeneration只加一次，舊GET／POST皆404；既有super session仍有效。重啟同週不換網址。

清除測試Redis的該queue排程再啟動worker，仍依DB補一次。輪換DB失敗保持舊key；retry成功只有一個新週期。純REPL查詢不改row、啟動不出現queue consumer／mail／S3／Portal連線。

驗證舊表單提交與輪換競態：輪換先commit則登入404；登入先commit則session有效。HTTP／console兩種啟動均不得註冊週排程。

## 4. 跨實例帳密輪換（US4）

兩個測試server共享DB／Redis但載不同帳密設定。舊設定已active時新設定登入503；以新設定REPL activate一次後，舊session於兩實例皆不能用，舊實例不能新登入且不能改回DB版本。新實例可新登入，員工session兩側仍有效。

same fingerprint activate no-op；錯expectedGeneration拒絕；同設定重啟不撤會話；再啟用舊設定也要新generation，之前舊session不能復活。版本啟用與舊super revoke／安全事件須同交易，故障注入驗證rollback。

## 5. UI與紀錄邊界

- 無效entry的HTML與RSC都不能含帳密表單，pre-render proxy檢查不可只放layout；entry驗證GET無Set-Cookie及DB寫入。
- 正常登入、401／404／409／429／503、guard及SSR例外，檢查Nest log、Next log、nginx access/error log沒有入口原值、密碼或cookie；REPL currentEntry是唯一指定主動揭露。
- 頁面no-store／no-referrer／noindex且不能iframe；此限制不得套到WebView或一般嵌入頁。
- 身分切換清舊query cache，Super user標示與登出可用；與入口網不匹配時按既有EmbedBridge流程重新launch。
- 安全事件只有白名單欄位；不新增簽署事件鏈、不碰既有證據。

## 6. Migration／回復

隔離測試庫驗證apply→down→apply；down僅空維護資料允許，有安全事件／維護session時應明確拒絕資料損失。既有employee session保持有效、users與文件FK未變、CHECK與entity一致；使用專案schema dump工具更新快照。部署／回復按operations，不在此指南提供正式刪表命令。

## 驗收記錄

各 ticket 實作者以獨立小節記錄：實際指令與結果、未跑原因、schema 變化、兩實例測試、iframe 瀏覽器結果、代理遮罩證據（不得包含敏感值）。未列出的 1～6 節項目尚未執行。

### 027-02 共用會話與 schema（T001～T014、T053）

範圍只有持久約束、repository、SessionService 與員工相容；隱藏登入頁、REPL、週排程與前端尚未存在，1、3～5 節不適用。

- schema（6 節）：`pnpm -C server test:schema` 6 suites／39 tests 通過，其中 `test/super-user-schema.e2e-spec.ts` 7 tests 在 `feastogether_intranet_test_a_<hex>` 臨時庫驗證：空庫 apply 後欄位型別／NULL／CHECK／FK／unique／索引與 entity 無 drift；既有員工 session（validating、failed、pending、active、revoked）回填 `employee`、其他欄位與 users／文件關聯不變；空維護資料 down 後 `SHOW CREATE TABLE auth_sessions` 與原定義相同，再 apply 無 drift；歷史 active 列缺 `expires_at` 時整個 ALTER 失敗、不留新欄位或新表；有安全事件、維護入口或 Super user 會話時 down 拒絕且資料不變。結束後無殘留臨時庫。
- 開發庫 `feastogether_intranet_027a`（只經 `server/.env`）：空庫 `pnpm -C server migration:run` 全部 21 支成功 → `migration:revert` 撤 `SuperUserAccess1793836802000` 成功（兩表與三欄消失）→ 寫入一筆合成員工 active session 後 `migration:run`，該列回填 `employee`／generation NULL／replacement NULL → 再寫入一筆合成 Super user 會話，`migration:revert` 以「無法回滾…」拒絕，migration 紀錄仍在 → 刪除合成列，保留已套用狀態。`pnpm -C server schema:dump` 更新 `server/src/infrastructure/database/schema.sql`：新增 `auth_security_events`、`super_user_access` 與 `auth_sessions` 三欄／兩索引／一 FK／兩 CHECK；`users`、`esign_export_jobs` 僅欄位順序與實際 migration 結果對齊，`esign_initiation_jobs` 由手寫格式改為 mysqldump 正規格式，結構相同。
- 會話（2 節中可在本張驗證的部分）：`test/security-actor-session.e2e-spec.ts` 7 tests 對真實 MySQL 驗證員工回應保留原 user 並新增 actor、Super user 會話 `user_id` NULL 且員工 guard 回 401、停用／soft-deleted 員工拒絕、DB 版本失配拒絕、本機 fingerprint 不符或入口 soft-delete 回 503、同一舊 token 並行替換一筆成功另一筆 409、替換中途失敗 rollback 保留舊會話、登出撤銷與事件倒序分頁。「兩個帶不存在 cookie 的登入都鎖定後才插入」一案在 REPEATABLE READ 下 2/2 次重現 deadlock，改用 READ COMMITTED 後通過。八小時不滑動、過期與撤銷另由 `session.service.spec.ts` 驗證。
- 員工回歸：`pnpm -C server test` 122 suites／1238 tests、`pnpm -C server test:e2e:security` 15 suites／91 tests、`pnpm -C server build`、`pnpm -C server lint:check`（0 errors；新檔無 warning）。
- `pnpm -C server test:e2e`：542 passed／1 skipped／1 failed；失敗為 `api-coverage` 的 `GET /api/esign/documents/{id}/history`（路由已在本張前由 `9344734` 移除，但 003 openapi 仍列出），與本張無關。`webview-session`、`oauth-login`、`password-login` 3 suites／36 tests 通過。
- 未執行：client lint／build 與 root build／lint（本張未改 client）；兩實例、iframe 瀏覽器、代理遮罩（尚無對應功能）。

### 027-03 窄 REPL 初始化與查詢（T015、T016）

範圍只有 1、3 節中的 REPL 初始化與唯讀查詢；隱藏登入、週輪換與帳密啟用尚未存在。

- 自動測試：`src/features/auth/helpers/rotation-period.spec.ts` 8 tests，涵蓋週一 03:59:59.999／04:00、週日深夜、UTC 與台北跨日、跨年；在 `TZ=UTC`／`America/New_York`／`Pacific/Chatham` 下結果相同。`test/super-user-console.e2e-spec.ts` 10 tests（`feastogether_intranet_test_a`），驗證：
  - 窄模組圖不含 App／Worker／Framework／Infrastructure／Auth／BullRoot／Redis／Portal／Mail／FileStorage，啟動不寫入；`auth` 只有三個 helper。
  - 未初始化時查詢回 503 且不寫入。
  - 初始化欄位與兩筆 operator 事件；重複初始化不覆寫；兩交易並發只成功一次；事件失敗整筆 rollback。
  - 查詢結果欄位完全等於契約且前後資料不變；fingerprint 不符時 `localConfigMatches=false`；`close()` 後連線池已銷毀。
- 初始化交易沿用預設 REPEATABLE READ。若在 INSERT 前先做 `FOR UPDATE`，空表 gap lock 會讓並發初始化 2/2 次 deadlock；實作直接以 INSERT 競爭 PK=1，因此不需要 READ COMMITTED。
- 開發庫 `feastogether_intranet_027a`：以 pty 操作 `pnpm -C server repl:dev`，依序 `currentEntry()`（503）→ `initialize()`（`initialized:true`）→ `credentialStatus()`（generation 1、`localConfigMatches:true`）→ `currentEntry()`（`/ops-access/<遮罩>`、entryGeneration 1、nextScheduledAt 台北下週一 04:00）→ `initialize()`（`initialized:false`）→ `.exit`（exit 0）。
- 建置後 `pnpm -C server repl`：
  - `initialize()` 回 false；`currentEntry()`／`credentialStatus()` 與開發模式一致。
  - `get`／`$`／`select`／`debug`／`methods` 都不存在。
  - session 中 DB 連線 1 條，`.exit` 後 0 條。
  - 設定 `NODE_REPL_HISTORY` 也不會產生 history 檔。
  - hash 格式錯誤時啟動 exit 1，訊息不含值。
- 回歸：`pnpm -C server test` 123 suites／1246 tests；`test:e2e:security` 15 suites／91 tests；`test:schema` 6 suites／39 tests（無臨時庫殘留）；`test:e2e` 552 passed／1 skipped／1 failed（既有 `api-coverage` history 路由，同 027-02）；`lint:check` 0 errors；`build` 成功。
- 展示後已刪除開發庫的 singleton 與兩筆 operator 事件。
- 未執行：實際 spawn REPL 的自動化測試（留給 T043）；client 與 root build／lint（本張未改 client）。

### 027-04 隱藏登入、身分顯示與登出（T003、T017～T026、T028、T050、T051）

範圍是 1 節的登入／錯密碼／登出、5 節的頁面與 log 邊界；週輪換（3 節）、帳密輪換（4 節）、OAuth／WebView 身分切換尚未實作。

**T003 現行入口盤點（實作前）**

- `server/src/features/auth/auth.module.ts`：`AuthGuard` 以 `APP_GUARD` 全域套用，`@Public()` 才略過；登入路由用 `OriginGuard`＋`AuthThrottlerGuard`（Redis storage，`short` 10 次／60 秒、`long` 50 次／300 秒，tracker 為 `req.ip`、`trustProxy: 1`）。`GET /auth/session` 經 `AuthService.getMe`，需要數字 userId，Super user 會話會被當成未登入。
- `client/src/proxy.ts`：只涵蓋 `(main)` 的 `/`、`/forms`、`/my-signature`、`/export-history`；帶 cookie 呼叫 `GET /api/auth/session`，401 改寫成 404（HTML 與 RSC 都不含頁面）。
- `client/src/features/embed/EmbedBridge.tsx`：比對 `session.data.user.empId` 與 launch 的員編，不同就 `DELETE /api/auth/session` 再要求入口網重新 launch。Super user 會話的 `user` 是 null，結果是 mismatch，所以不需修改。
- `client/src/components/providers/ReactQueryProvider.tsx`：query／mutation 的任何 401 都先開整頁 SessionExpiredDialog，判斷在 `suppressGlobalErrorToast` 之前；這個 meta 只能關 Snackbar，關不掉 dialog。帳密錯誤因此需要專用錯誤碼 `AUTH_SUPER_USER_CREDENTIALS_INVALID` 並在 provider 排除。

**自動測試**

- 新增：
  - `test/security-super-user-access.e2e-spec.ts`：26 tests，隔離庫 `feastogether_intranet_test_a`、`REDIS_DB=6`。
  - `super-user-login.service.spec.ts`：11 tests。
  - `super-user-throttler.guard.spec.ts`（1 test，缺 client IP 回 503）、`session-view.dto.spec.ts`（2 tests）。
  - 改寫 `auth.guard.spec.ts`（16 tests）：403 `AUTH_ACTOR_NOT_ALLOWED`、`@AllowSuperUser()`。
  - `request.context.spec.ts`／`http-access-log.interceptor.spec.ts` 新增維護路徑案例：成功、404、401、handler 例外。
- e2e 涵蓋：
  - GET：目前入口回 200，no-store、無 Set-Cookie、DB 不變；無效入口 404；未初始化或 soft-delete 回 503；DB 失敗回 503。
  - POST 成功：201 回 super 身分；cookie 為 HttpOnly、`Path=/`、`Max-Age=28800`、`SameSite=Lax`、無 Domain；body 不含 token、帳號或入口。
  - 錯帳號、錯密碼、帳號前後空白都回同一個 401，原員工會話保持有效。
  - 員工 cookie 被原子替換，舊 cookie 再登入回 409。
  - 舊入口回 404，且不先跑 DTO 驗證。
  - KDF 期間入口輪換先 commit：回 404，不簽發會話。
  - DTO 400 時不跑 KDF；128 字元 emoji 帳號與 1024 bytes 密碼在邊界內；孤立 surrogate 回 401 而不是 500。
  - Origin 缺少、不受信任或跨站回 403；body 9 KiB 回 413。
  - 同 IP 第 11 次回 429 與 Retry-After，不隨 entryKey 分桶；限流儲存不可用回 503。
  - Super user 呼叫員工業務端點回 403；登出後會話失效。
- Mutation 檢查：拿掉 `SessionService` 交易內的入口重驗，`session.service.spec.ts` 1 test 與 e2e「KDF 期間入口輪換」1 test 失敗；已還原。
- 回歸：
  - server：`pnpm -C server test` 126 suites／1270 tests；`test:e2e:security` 16 suites／117 tests。
  - `test:e2e`：552 passed、1 skipped、1 failed（50 suites passed）。唯一失敗是既有的 `api-coverage` history 路由，同 027-02。
  - `lint:check`：0 errors、276 warnings，逐檔與本張前相同，新檔 0 warning；`build` 成功。
  - client：`pnpm -C client lint`、`pnpm -C client build` 成功，`/ops-access/[entryKey]` 為動態路由（ƒ）。
- 未執行：`test:schema`（本張沒有 migration 或 entity 變更）、root `pnpm build`／`pnpm lint`。

**真實旅程（開發庫 `feastogether_intranet_027a`、`REDIS_DB=9`，server `PORT=3011`，client `-p 3010`）**

- 環境：`server/.env` 填合成 `SUPER_USER_ACCOUNT`／`SUPER_USER_PASSWORD_HASH`（隨機密碼只放在 repo 外的暫存檔，驗證後刪除）。`AUTH_TRUSTED_ORIGINS` 加上 `http://localhost:3010`。
- REPL：以 pty 操作 `pnpm -C server repl:dev`，執行 `initialize()` → `credentialStatus()`（`localConfigMatches:true`）→ `currentEntry()` 取得入口；入口原值不寫入任何文件。
- curl（開發模式與 `next build` 後的 `next start`）：
  - 有效入口 HTML 回 200，帶 `Referrer-Policy: no-referrer`、`X-Robots-Tag: noindex, nofollow`、`Content-Security-Policy: frame-ancestors 'none'`；正式 build 另有 `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`。
  - 無效入口的 HTML 與帶 `RSC: 1` 的請求都回 404，回應不含密碼欄位。
  - 有效入口的 RSC 請求先 307 到 `?_rsc`，再回 200。
  - 正式 build 的 `/embed` 與 `/external-signatures/<id>` 不帶上述三個 header，入口網 iframe 與 WebView 規則不受影響。
  - 開發模式下把 singleton soft-delete：頁面回 500，Next log 只有「維護入口檢查失敗：HTTP 503」；之後已還原。
- 瀏覽器：Playwright 1.63（安裝在 repo 外暫存目錄）驅動 Chromium，分別對開發模式與正式 build 各跑一次，結果相同：
  - 無效入口顯示 404 頁，沒有密碼欄位。
  - 有效入口顯示「維護登入」表單。
  - 錯密碼：表單內顯示「帳號或密碼錯誤」，沒有出現「登入已過期」dialog，沒有 cookie，網址不變。
  - 正確帳密：`location.replace('/')` 經 proxy 轉到 `/forms`，cookie 為 `FT_ESIGN_SESSION` HttpOnly、SameSite=Lax、Path=/、host-only。登入 POST 帶 `Origin` 與 `Sec-Fetch-Site: same-origin`，沒有 Referer。
  - 登入後：版面上方持續顯示「目前身分：Super user」與「登出」；文件列表回 403，顯示「目前身分無法使用此功能」（028 前預期行為）。
  - 上一頁回到前一個無效入口，有效入口沒有留在瀏覽紀錄。
  - 登出：回根路徑顯示 404 頁，banner 消失，`GET /api/auth/session` 回 401，cookie 已清除。
  - 在頁面內以 `fetch` 帶 `RSC: 1` 請求無效入口，回 404，回應不含表單。
- 開發庫事件：`login.rejected`（anonymous／credentials_invalid）、`login.succeeded`（super_user）、`session.revoked`（super_user／logout）都有寫入；會話全為 revoked。展示後已刪除開發庫的 singleton、事件與 Super user 會話。
- log 邊界：
  - Nest 的 `server.log`、Next 開發與正式 log：入口、密碼、cookie 值各 0 筆命中。
  - Nest access log 只有 `/api/auth/super-user-entries/:entryKey` 與 `…/:entryKey/sessions`。
  - `next dev` 的 `.next/dev/trace` 會記錄含入口的 request URL。這是本機開發的 trace 檔，不在正式環境產生，驗證後已刪除。
- 倉庫外代理：Nginx／ALB 的 access／error log 尚未遮罩，已在 `docs/deployment/uat-cicd.md` 列為部署阻擋；本節不代表全鏈 log 已驗收。

### 027-06 每週輪換與停機補做（T037～T044）

範圍是 3 節的入口輪換、並發與 REPL 副作用；帳密輪換（4 節）與 OAuth／WebView 身分切換不在本張。

**排程註冊方式（對齊 [operations](contracts/operations.md)）**

- 只有 `WorkerModule` 載入 `SuperUserAccessWorkerModule`：queue `auth-access-maintenance`、scheduler `super-user-entry-weekly`、job `rotate-entry-if-due`、`0 4 * * 1`／`Asia/Taipei`、空 payload、`attempts: 3`、exponential backoff 5000ms、`removeOnComplete: 100`、`removeOnFail: 100`。
- worker 啟動時先以 DB 補做（直接執行與 job 相同的 processor），再看 Redis：已到期未執行的 job 保留不覆寫，否則 upsert。補做失敗讓 worker 啟動失敗。
- 輪換鎖 singleton，DB 已處理週期早於最近到期週期才換入口；結果為 `rotated`／`not_due`／`uninitialized`，也是 job 回傳值。失敗原因只帶錯誤代碼。

**自動測試**

- 新增：
  - `super-user-access.service.spec.ts`：8 tests。以 fake timers 驗證週一 03:59:59.999 no-op、04:00 輪換、同週再執行 no-op、跨年、停機多週只補一次、初始化後同週不輪換、未初始化不建列、寫入失敗 rollback。
  - `super-user-access.scheduler.spec.ts` 4 tests、`super-user-access.processor.spec.ts` 4 tests：排程參數、補做先於排程、過期 job 不覆寫、補做失敗不註冊、未初始化結果與警告、失敗原因與 log 不含原始訊息。
  - `test/super-user-entry-rotation.e2e-spec.ts`：10 tests，正式 `WorkerModule`（Portal 匯入換成替身）＋正式 `AppModule`，測試庫 `feastogether_intranet_test_b`、`REDIS_DB=10`。
- e2e 涵蓋：
  - HTTP app 沒有維護 queue、scheduler、processor，也不在 Redis 建排程。
  - 停機三週後兩個 worker 同時啟動：只換一次（entry generation 2、一筆 `system` 事件），帳密版本不變，Redis 只有一份排程，下次為下週一台北 04:00。
  - 同週重啟兩次不換；清掉 Redis 排程並落後一週後重啟：補做一次並重建排程。
  - 錯過的 job 仍在 Redis 時啟動：補做與該 job 合計只換一次，下次排程回到下週一。
  - job 第一次寫入失敗：失敗原因為「維護入口輪換失敗（ER_LOCK_WAIT_TIMEOUT）」、stacktrace 不含原始訊息、舊入口仍 200；5 秒後重試成功，只換一次，舊入口 404。
  - 未初始化：worker 照常啟動，job 回 `uninitialized`，不建列。
  - 輪換後舊入口 GET／POST 404（含輪換前已開的表單），新入口 200，輪換前登入的 Super user 會話仍 200。
  - 兩個執行者同時輪換：一個 `rotated`、一個 `not_due`。
  - KDF 期間輪換先 commit：舊入口登入 404，不簽發會話。
  - 登入交易先鎖 singleton：輪換等到登入 commit 後才完成，該會話仍有效。
- `test/super-user-console.e2e-spec.ts`：14 tests（原 10 個）。新增 REPL 未初始化時輪換回 `uninitialized`；未到期 no-op、到期以 `operator` 輪換一次且帳密版本不變；`securityEvents` 預設 20 筆、`limit` 0／101 拒絕、`beforeId` 倒序、只回白名單欄位且不寫入；以 `pnpm -s repl:dev` 同時啟動兩個真正 REPL：初始化只成功一次、重複不覆寫、查詢不寫入、`currentEntry` 之前輸出不含入口、`.exit` 後 exit 0。模組圖另確認不含 `SuperUserAccessWorkerModule`。
- Mutation 檢查：把輪換的 `findForUpdate` 改成 `find`，e2e 有 3 tests 失敗（兩 worker 同時啟動、錯過的 job、兩執行者同時輪換）；已還原。
- 回歸：`pnpm -C server test` 129 suites／1286 tests；`test:e2e` 566 passed、1 skipped、1 failed（51 suites passed；唯一失敗是既有 `api-coverage` history 路由，同 027-02）；`test:e2e:security` 16 suites／117 tests；`test:schema` 6 suites／39 tests（無臨時庫殘留）；`lint:check` 0 errors、276 warnings（與 027-04 相同，新檔與改動檔 0 warning）；`build` 成功。

**實際 worker／REPL／HTTP（開發庫 `feastogether_intranet_027b`、Redis `127.0.0.1:16321` DB 2，HTTP `PORT=3021`）**

- 空庫 `migration:run` 21 支；`pnpm -C server repl:dev` 逐行執行：`rotateEntryIfDue()` 回 `uninitialized` → `initialize()` true → `credentialStatus()` generation 1、`localConfigMatches:true` → `rotateEntryIfDue()` `not_due` → `initialize()` false。
- 把已處理週期往前推兩週後 `pnpm -C server worker:dev`：啟動補做一次（entry generation 2、`system` 事件），period 回到 2026-11-02 04:00（台北）；Redis 排程 pattern `0 4 * * 1`、tz `Asia/Taipei`、opts 同上，下次 2026-11-09 04:00（台北）。Portal 每日匯入排程下次為 2026-11-06 04:00，未到期、未查 Portal。
- 建置後 `node dist/worker`（`NODE_ENV=development`）：同週重啟不換；刪除該 queue 的 Redis key 並落後一週後重啟，補做一次並重建排程。
- 以 BullMQ `promote()` 提前執行排程 job：`attemptsMade` 1、回傳 `rotated`、`system` 事件。提前執行會讓 BullMQ 從原排定時間算下一次（跳過一週），只用於驗證；需要立即補做請用 REPL `rotateEntryIfDue()`。
- HTTP（`node dist/main`）啟動後 Redis 沒有 `bull:auth-access-maintenance:*` key。舊入口 GET 200 → REPL `rotateEntryIfDue()`（`rotated`，再執行為 `not_due`）→ 舊入口 GET／POST 404、新入口 GET 200。HTTP 與 worker log 中含入口值的路徑 0 筆，access log 只有 `:entryKey` 模板。
- 建置後 `pnpm -C server repl`（設定 `NODE_REPL_HISTORY`）：`initialize()` false、`currentEntry()` path 格式正確、`rotateEntryIfDue()` `not_due`、`securityEvents({limit:3})` 倒序、`beforeId` 翻頁、`limit:101` 回 RangeError、`get`／`$` 不存在；`.exit` 後 exit 0、該庫連線 0 條、沒有 history 檔。
- 驗證後已刪除開發庫的 singleton 與事件（會話 0 筆），並清空 Redis DB 2（驗證前為空）。

**未執行／限制**

- 停機情境以「DB 已處理週期落後」「刪除 Redis key」「注入 DB 錯誤」模擬；沒有在 UAT 實際停機跨過週一 04:00、Redis 故障切換或多台主機的 worker 上執行。
- 每個 worker 以自己的時鐘判斷到期，主機需 NTP 對時。
- 週一 04:00 DB 不可用超過重試窗（約 5＋10 秒）時，job 失敗後不會再自動嘗試，要等下次 cron 或 worker 重啟補做；失敗可從 failed job 與 `auth.entry_rotation_failed` log 看到，維護者可用 REPL `rotateEntryIfDue()` 補做。這是契約既定的重試次數與「不增加掃描排程」。
- 非 TTY 一次輸入多行時，REPL 不等前一行的 `await` 完成就執行下一行，`.exit` 可能在查詢完成前關閉連線池（027-03 既有行為）；逐行執行沒有此問題。

### 027-07 帳密啟用與跨實例撤銷（T045～T049）

範圍是 4 節。網址輪換（3 節）與 OAuth／WebView 身分切換不在本張。

**生效點與部署條件**

- 生效點是 `await auth.activateCredentials({ expectedGeneration })` 的交易 commit。同一交易內：
  - DB 啟用指紋換成 REPL 本機設定，`credential_generation` 加 1，`credential_activated_at` 更新。
  - 全部 active 維護會話改為 revoked。
  - 寫入一筆 `credentials.activated` 事件。
  - 入口與 `entry_generation` 不變。
- commit 前，已換新設定的實例：維護登入與既有維護會話都回 503（`AUTH_SUPER_USER_UNAVAILABLE`），員工照常。
- commit 後：
  - 舊維護會話在所有實例都回 401，因為已撤銷。
  - 仍是舊設定的實例：維護登入與新維護會話都回 503，直到改成新設定並重啟。
  - 已換新設定的實例可以登入維護身分。
  - 員工會話在新、舊設定的實例都有效。
- 混跑期間，負載平衡後面只要還有舊設定實例，維護操作就可能間歇 503，所以不能宣稱維護登入零中斷。
- 完成條件：所有 HTTP 與 worker 都換成新設定並重啟，每個執行環境的 REPL `credentialStatus()` 都回 `localConfigMatches: true`，並在實際入口完成一次維護登入驗證。只更新部分實例不算完成。
- 任何實例啟動都不會寫 DB 版本。舊設定實例重啟也改不回去。要回復舊設定，必須在舊設定的 REPL 明確 activate，得到更高的 generation；先前的會話不會復活。

**自動測試**

- `src/features/auth/services/super-user-credentials.service.spec.ts`（9 tests，記憶體替身）：
  - 新設定使 generation 加 1，同時更新指紋、生效時間、撤銷與事件。
  - 再啟用先前的設定時 generation 仍會增加（1→2→3）。
  - 相同指紋為 no-op。
  - expectedGeneration 為 0、2 或字串 `'1'` 時，以及相同設定但版本不符時，一律回 409 `AUTH_SUPER_USER_GENERATION_CONFLICT` 且不寫入。
  - 事件寫入失敗時整筆 rollback。
  - 未初始化時回 503。
- `test/super-user-console.e2e-spec.ts` 新增 4 tests（真實 MySQL，`feastogether_intranet_test_c`）：
  - 只撤 active 維護會話；入口欄位、員工會話與已撤銷的列都不變；寫入一筆 operator 事件。
  - 兩個交易在鎖 singleton 前會合，再並發用同一個 expectedGeneration 啟用：一筆 `{activated:true}`，另一筆回版本衝突。
  - 事件寫入失敗時，版本、指紋與會話都不變。
  - 與「Super user → 員工」切換交錯：測試照 `SessionService.replace` 的 SQL 順序，以 READ COMMITTED 先鎖舊會話，等啟用交易進入鎖等待後，再插入員工會話並撤舊。結果不 deadlock，切換寫入的 `revoked_at` 與 replacement 也不會被覆寫。
  - 連跑 5 次都是 14 passed。
- `test/security-super-user-credentials.e2e-spec.ts`（6 tests，約 8 秒）：
  - 用 `node --conditions=development -r ts-node/register src/main.ts` 啟動兩個獨立 HTTP 程序：A 是舊設定（port 3030），B 是新設定（port 3031），共用 `feastogether_intranet_test_c` 與 Redis DB 11。
  - 每次 REPL 操作都另起一個程序，執行 `test/helpers/run-auth-console.ts`，載入指定設定並呼叫 `createAuthConsole`。
  - 依序驗證：
    1. B 啟動不改 DB。B 的登入與 A 簽出的會話在 B 都回 503；新設定 REPL 的 `credentialStatus()` 回 `localConfigMatches:false`。員工在兩側都是 200。
    2. A 以相同設定重啟，會話仍有效，DB 不變。
    3. expectedGeneration=2 回 409，不撤銷。
    4. 新設定 activate(1)：舊會話在兩側都回 401，A 登入回 503。A 重啟後 generation 仍是 2，登入仍回 503。B 可以登入；B 簽出的會話在 A 回 503。員工在兩側都是 200。
    5. 再 activate(2) 為 no-op，B 會話仍有效。
    6. 舊設定 activate(2)：generation 變成 3，先前兩個會話在兩側都回 401；A 可以重新登入，B 登入回 503。員工在兩側都是 200。operator 事件的 generation 依序是 1、2、3。
  - 結束後兩個程序都已停止、port 都已釋放，測試庫沒有殘留列。
- 先寫測試：實作前 unit spec 因找不到模組而失敗。只還原 `repl.ts`／module 時，console e2e 5 failed，雙實例 e2e 4 failed（啟用前的 2 步是既有行為，通過）。
- Mutation 檢查（都已還原）：
  - 改回單一條件 UPDATE：死鎖競態 2/2 次出現 `Deadlock found`（REPEATABLE READ）。第一版實作是 READ COMMITTED 加單一條件 UPDATE，同樣 deadlock。
  - 拿掉撤銷：console e2e 2 failed，雙實例 e2e 3 failed。
  - 事件改用非交易 manager：console e2e 3 failed。
  - UPDATE 拿掉 `status='active'` 重驗：死鎖競態 1 failed（`revoked_at` 被覆寫）。

**REPL 實際展示（開發庫 `feastogether_intranet_027c`、Redis `127.0.0.1:16321` DB 3，只經 `server/.env`）**

- 準備：
  - 對空庫跑 `pnpm -C server migration:run`，套用 21 支。
  - 隨機產生兩組合成密碼 A、B（放在 repo 外的暫存檔），以 `hashSuperUserPassword` 產生 hash。
  - REPL 以 Python `pty` 操作；入口原值與 hash 在輸出中遮罩。
- 開發模式 `pnpm -C server repl:dev`，`.env` 為設定 A：
  - `Object.keys(auth)` 是 4 個 helper。
  - 未初始化時 `activateCredentials({expectedGeneration:1})` 回 503 `AUTH_SUPER_USER_UNAVAILABLE`。
  - `initialize()` → `{initialized:true}`；`credentialStatus()` → `{generation:1, localConfigMatches:true}`；`currentEntry()` 回遮罩後的 path。
  - `.exit` 結束，exit 0。
- HTTP 實例：以 `node --conditions=development -r ts-node/register src/main.ts` 啟動，`NODE_ENV=test`。
  - 開機必填但 `.env` 沒有的 OAuth／WebView／邀請金鑰用合成值。
  - Portal 指向不存在的庫，避免碰到真實 Portal。
  - 實例 A（設定 A，3030）以 curl 登入：201，GET session 200 super_user。
- 把 `.env` 換成設定 B 後，以 `pnpm -C server repl:dev` 操作：
  - `credentialStatus()` → `{generation:1, localConfigMatches:false}`。
  - `activateCredentials({expectedGeneration:2})` → 409 `AUTH_SUPER_USER_GENERATION_CONFLICT`，訊息「expectedGeneration 不是目前的帳密啟用版本，請以 credentialStatus() 確認後再啟用」。
  - `activateCredentials({expectedGeneration:1})` → `{activated:true}`；`credentialStatus()` → `{generation:2, localConfigMatches:true}`。
  - `activateCredentials({expectedGeneration:2})` → `{activated:false}`。
- 啟用後的 HTTP 結果：
  - A：舊會話 401 `UNAUTHORIZED`；設定 A 的密碼登入回 503。
  - 啟動實例 B（設定 B，3031）：舊會話 401；舊密碼 401 `AUTH_SUPER_USER_CREDENTIALS_INVALID`；新密碼 201；新會話在 B 回 200，在 A 回 503。
- 建置模式 `pnpm -C server repl`，以環境變數覆寫回設定 A：
  - `[typeof get, typeof $, typeof select]` 全為 `'undefined'`。
  - `credentialStatus()` → `{generation:2, localConfigMatches:false}`。
  - `activateCredentials({expectedGeneration:2})` → `{activated:true}`；`credentialStatus()` → `{generation:3, localConfigMatches:true}`。
  - 之後 B 的會話 401，最早的會話仍是 401（沒有復活）。A 以設定 A 重新登入 201，B 登入 503。
- 重啟：
  - A 以設定 A 重啟後，第 3 版會話仍是 200；同一會話在設定 B 的 B 回 503。
  - 展示中曾讓 A 讀到已改成 B 的 `.env` 重啟，結果該會話回 503，正好就是「只更新部分實例」的狀態。
  - DB 始終是 generation 3，沒有被任何啟動改寫。
- DB 事件依序為：
  1. `entry.initialized`
  2. `credentials.activated`(1)
  3. `login.succeeded`(1)
  4. `credentials.activated`(2)
  5. `login.rejected`（舊密碼打 B）
  6. `login.succeeded`(2)
  7. `credentials.activated`(3)
  8. `login.succeeded`(3)
- 收尾：
  - 兩種 REPL 都設定 `NODE_REPL_HISTORY` 指向暫存路徑，結束後該檔不存在。
  - 展示後已停止兩個 HTTP 程序，刪除開發庫的 singleton、事件與會話（migration 保留），也刪除暫存密碼、hash 與 cookie。
  - `server/.env` 留下設定 B 的 hash，對應密碼已丟棄。
- 最後一個改動是把啟用時間改成取得 singleton 鎖之後才取，以上展示在這個改動之前執行。改動後重新 build，以建置模式 REPL 在同一開發庫重跑一次：
  - `initialize()` → `credentialStatus()`，結果為 generation 1、相符。
  - 以另一組合成 hash 覆寫環境變數後，`credentialStatus()` 回不相符；`activateCredentials({expectedGeneration:1})` → `{activated:true}`；`credentialStatus()` → generation 2、相符。
  - 結束後刪除產生的列。

**回歸**

- `pnpm -C server test`：127 suites／1279 tests 通過。
- `pnpm -C server test:e2e:security`：17 suites／123 tests 通過。
- `pnpm -C server test:e2e`：556 passed、1 skipped、1 failed。失敗為既有 `api-coverage` 的 history 路由，同 027-02。
- `pnpm -C server lint:check`：0 errors、276 warnings，與本張前相同。
- `pnpm -C server build`：成功。

**未執行**

- `test:schema`：本張沒有 migration 或 entity 變更。
- client 與 root build／lint：本張沒有改 client。
- 正式／UAT 的多實例與負載平衡實測。
