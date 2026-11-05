# 03: 透過窄 REPL 初始化及查詢維護入口

**What to build:** 維護者能在不啟動應用 HTTP、業務 worker 或外部人事服務的維運環境，明確建立唯一入口、查詢目前位置及診斷設定是否生效。

**Status:** resolved

**Blocked by:** [02-actor-aware-sessions](02-actor-aware-sessions.md)

**Source:** [Spec](../../../specs/027-super-user-access/spec.md)、[Plan](../../../specs/027-super-user-access/plan.md)、[Tasks](../../../specs/027-super-user-access/tasks.md)、[資料模型](../../../specs/027-super-user-access/data-model.md)、[API 行為](../../../specs/027-super-user-access/contracts/api-behavior.md)、[維運契約](../../../specs/027-super-user-access/contracts/operations.md)、[驗收指南](../../../specs/027-super-user-access/quickstart.md)。

**Scope:** T015、T016。

## Acceptance Criteria

- [x] 真正 REPL 可呼叫 initialize、currentEntry、credentialStatus；啟動不自動初始化，查詢不寫入，未初始化回明確結果。
- [x] 首次初始化以 singleton PK 仲裁，產生 32 random bytes 的 43 字元 base64url 入口與兩個初始 generation；記錄最近週一台北 04:00 的已到期週期及同交易安全事件。
- [x] 重複初始化不覆寫入口或憑證版本；有並發時只有一組有效初始狀態。週期 helper 的邊界行為有測試，後續排程直接沿用。
- [x] 只有明確 currentEntry 呼叫回傳目前路徑與時程；credentialStatus 不回帳號、hash 或 fingerprint。
- [x] 窄 context 不啟動 HTTP、queue consumer、Portal、mail、storage 或自動同步，不暴露裸 SQL／repository helpers，不保留 REPL history；結束關閉 DB 連線。
- [x] 開發與建置後 REPL 指令可用，實際展示「初始化 → 查入口／狀態 → 結束」；完整副作用與並發回歸在 027-06 再驗。

## Comments & Implementation Results

### 2026-11-05 實作結果（分支 `027-03-narrow-repl-entry`）

**變更摘要（只有 server，無 client／migration／schema 變更）**

- `server/src/features/auth/helpers/rotation-period.ts`：`latestDueRotationPeriod(now)` 回不晚於 now 的最近週一台北 04:00（UTC `Date`）；`nextRotationPeriod(period)` 回七天後的週期起點。用 `@date-fns/tz` 以 Asia/Taipei 計算，不受 server 時區影響；`now` 由呼叫端傳入，測試不需要時間 env。
- `server/src/features/auth/services/super-user-access.service.ts`：
  - `initialize()`：在一個交易內寫入 singleton（32 random bytes 的 base64url 入口、`entry_generation`／`credential_generation`=1、fingerprint=本機設定、`period_start_at`=最近已到期週期），並寫 `entry.initialized`、`credentials.activated` 兩筆事件（actor `operator`、outcome `succeeded`）。回 `{initialized}`，不回入口。
  - 並發由 PK=1 仲裁：`SuperUserAccessRepository.insertIfAbsent` 直接 INSERT，遇 `ER_DUP_ENTRY` 回 false。已存在的列不覆寫。
  - `currentEntry()` 唯讀，回 `{path:'/ops-access/<entryKey>', entryGeneration, rotatedAt, nextScheduledAt}`；`nextScheduledAt` 取 `nextRotationPeriod(period_start_at)`，早於現在代表輪換逾期。
  - `credentialStatus()` 唯讀，回 `{generation, localConfigMatches, activatedAt}`，不含帳號、hash 或 fingerprint。
  - 兩個查詢遇到未初始化都丟 `AUTH_SUPER_USER_UNAVAILABLE`（503），不會隱式初始化。
- `server/src/features/auth/super-user-access.module.ts`：只 import `MysqlModule`，提供 `SuperUserConfigService`、`AuthSecurityEventService`、`SuperUserAccessService`，匯出前兩者；沒有 controller、APP_GUARD 或啟動寫入。`AuthModule` 改為 import 它，不再自己註冊這兩個 service。
- `server/src/console/console.module.ts`：只組 `ConfigModule.forRoot({isGlobal, envFilePath:'.env'})`、`ClsModule.forRoot({global})`、`LoggingModule`、`SuperUserAccessModule`。不載 AppModule、WorkerModule、FrameworkModule、InfrastructureModule、AuthModule、Redis、BullMQ、Portal、mail 或 storage。
- `server/src/console/repl.ts`：
  - 以 `NestFactory.createApplicationContext(ConsoleModule, {logger:['error','warn']})` 建立 context，再用 `node:repl` 的 `start()` 開 REPL。context 只放 `auth = createAuthConsole(app)`，內容是三個閉包；service 本身不放進 context，因為它的欄位會帶出 MysqlService／repository。
  - REPL `exit` 時 `app.close()`，由既有 `MysqlLifecycleService` 銷毀連線池。
  - 沒有用 `@nestjs/core` 的 `repl()`：它會把所有 provider token 與 `get()`／`$()` 放進 REPL。程式化的 `repl.start()` 本來就不寫 history 檔。
- `server/package.json`：`repl:dev`＝`node --conditions=development -r ts-node/register src/console/repl.ts`（與 `super-user:hash-password` 同模式）；`repl`＝`node dist/console/repl`。兩者都由 ConfigModule 讀 `server/.env`，已設定的程序環境變數優先；`NODE_ENV` 沿用執行環境，不另行指定。
- 測試：`rotation-period.spec.ts`（8）、`test/super-user-console.e2e-spec.ts`（10，已加入 `jest-e2e.json` 白名單）。
- `specs/027-super-user-access/tasks.md` 勾選 T015、T016，並註明沒有建立 `auth-session.module.ts`、`auth-console.service.ts` 的理由；quickstart 驗收記錄新增「027-03」小節。

**驗證（實際指令與結果）**

- 先寫測試：`rotation-period.spec.ts` 與 console e2e 在實作前都因模組不存在而失敗；實作後分別 8／10 tests 通過。
- `rotation-period.spec.ts` 另外在 `TZ=UTC`、`TZ=America/New_York`、`TZ=Pacific/Chatham` 下各跑一次，都是 8 passed。
- console e2e（`test/super-user-console.e2e-spec.ts`，對 `feastogether_intranet_test_a`）：
  - 模組圖中沒有 App／Worker／Framework／Infrastructure／Auth／BullRoot／Redis／Portal／Mail／FileStorage module；建立 context 後表內仍無列，也沒有事件。
  - `auth` 只有三個 key。
  - 未初始化時兩個查詢都回 503 `AUTH_SUPER_USER_UNAVAILABLE`，且沒有寫入。
  - 首次初始化的欄位、32 bytes 入口、週期與兩筆事件都符合預期。
  - 先把列改成另一個 fingerprint／generation=2 再重複 initialize：回 false，列與事件不變。
  - 兩個交易在 INSERT 前會合後並發 initialize：只有一個 true，留下 1 列、2 筆事件。
  - 第二筆事件寫入失敗：整筆 rollback，入口與第一筆事件都沒有留下。
  - currentEntry／credentialStatus 回傳完全等於預期物件（沒有多餘欄位），前後整列（含 `updated_at`）與事件不變。
  - 改掉 DB fingerprint 後 `localConfigMatches=false`。
  - `close()` 後 DataSource `isInitialized=false`。
  - 連跑 5 次都是 10 passed，結束後測試庫沒有 singleton 或 operator 事件殘留。
- Mutation 檢查：拿掉 `ER_DUP_ENTRY` 判斷，2 tests 失敗（重複初始化、並發）；把事件改用非交易 manager 寫入，5 tests 失敗。兩者都已還原。
- 隔離等級評估：初始化維持預設 REPEATABLE READ，不需要比照 `SessionService` 改 READ COMMITTED。
  - 實驗：暫時在 INSERT 前加 `findForUpdate`。REPEATABLE READ 下並發測試 2/2 次 `Deadlock found`（空表 gap lock），改 READ COMMITTED 後 3/3 通過。
  - 實作因此不做鎖定讀取，直接用 INSERT 競爭 PK，在預設隔離等級下即無 deadlock（見上方 5 次連跑）。實驗程式已還原。
- `pnpm -C server lint:check`：0 errors、276 warnings，與本張前相同；新檔與修改檔單獨跑 eslint 為 0 errors、0 warnings。
- `pnpm -C server test`：123 suites／1246 tests 通過。
- `pnpm -C server build`：成功，產出 `dist/console/repl.js`、`console.module.js`。
- `pnpm -C server test:e2e:security`：15 suites／91 tests 通過（`AuthModule` 改 import `SuperUserAccessModule` 後的 HTTP 啟動回歸）。
- `pnpm -C server test:schema`：6 suites／39 tests 通過；結束後只剩 `feastogether_intranet_test_a`，沒有 `_<hex>` 殘留庫。
- `pnpm -C server test:e2e`：51/52 suites 執行，552 passed、1 skipped、1 failed。新增的 console 10 tests 都通過；唯一失敗是 027-02 已記錄的既有 `api-coverage`「GET /api/esign/documents/1/history」（期望 401、實得 404，源自 003 openapi 仍列出已移除路由），與本張無關。結束後測試庫沒有 singleton 或 operator 事件殘留。
- 實際展示（開發庫 `feastogether_intranet_027a`，只經 `server/.env`；`.env` 加了合成 `SUPER_USER_ACCOUNT`／`SUPER_USER_PASSWORD_HASH`，隨機密碼產生 hash 後即丟棄）。以 Python `pty` 模擬終端機操作，入口只列前 4 字元：
  - 開發模式 `pnpm -C server repl:dev`：
    - `await auth.currentEntry()` → `AppException: 維護登入暫時無法使用`（`code:'AUTH_SUPER_USER_UNAVAILABLE'`、`status:503`）。
    - `await auth.initialize()` → `{ initialized: true }`。
    - `await auth.credentialStatus()` → `{ generation: 1, localConfigMatches: true, activatedAt: 2026-11-05T06:28:30.914Z }`。
    - `await auth.currentEntry()` → `{ path: '/ops-access/fI1u…(遮罩)', entryGeneration: 1, rotatedAt: 2026-11-05T06:28:30.914Z, nextScheduledAt: 2026-11-08T20:00:00.000Z }`（台北 11/09 週一 04:00）。
    - 再一次 `await auth.initialize()` → `{ initialized: false }`。
    - `.exit` → 程序自行結束，exit 0。
  - 建置模式 `pnpm -C server build && pnpm -C server repl`：
    - `[typeof get, typeof $, typeof select, typeof debug, typeof methods]` 全為 `'undefined'`。
    - context 中除了 Node 內建全域，只有 `auth` 與函式庫自行掛上的 tslib helpers、`typeormMetadataArgsStorage`、Swagger metadata storage，都碰不到 DataSource。
    - `initialize()` → `{ initialized: false }`；`currentEntry()` 與開發模式相同的 path／generation；`credentialStatus()` 結果相同。
    - 另以每 0.5 秒查 `information_schema.processlist`：session 中有 1 條連線，`.exit` 後為 0；exit 0。
  - DB 上只產生 `entry.initialized`(operator, succeeded, entry_generation 1) 與 `credentials.activated`(operator, succeeded, credential_generation 1) 兩筆事件，`period_start_at`=2026-11-01 20:00:00 UTC（台北 11/02 週一 04:00）。展示後已刪除這兩筆事件與 singleton，開發庫回到 02 結束時的狀態。
  - history：兩次都設定 `NODE_REPL_HISTORY=<暫存路徑>`，結束後該檔不存在；`~/.node_repl_history` 的 mtime 不變。
  - 設定錯誤：`SUPER_USER_PASSWORD_HASH=not-a-hash node dist/console/repl.js` 啟動失敗、exit 1，訊息只有變數名，不含值。

**未驗證／限制**

- 沒有自動化測試實際 spawn REPL 程序；開發／建置兩種指令以 pty 手動展示為證據。T043（027-06）會補「repl／repl:dev import／env 模式一致」的自動化驗證。
- 未初始化時查詢回的是既有 `AUTH_SUPER_USER_UNAVAILABLE`（訊息「維護登入暫時無法使用」），依 T015「缺 row 明確 503」。在這兩個 helper 中，此錯誤只會因未初始化而出現（DB 故障會是其他錯誤），但訊息本身沒有寫「尚未初始化」。如果希望 REPL 顯示更直白的訊息，需要使用者決定是否新增錯誤定義。
- `nextScheduledAt` 規格只寫「時程」。本張定義為「目前入口預定輪換的時間」＝已處理週期＋7 天，逾期時會早於現在；沒有改用「下一次 cron 觸發時間」。
- REPL 不是沙箱（operations 契約）：context 仍有 Node 的 `require` 與函式庫掛在 global 的 metadata；限制的只是 Nest provider 與 DataSource 不經 helpers 外露。
- 部署 runtime image 沒有 pnpm，容器內要用 `node dist/console/repl.js`；部署說明屬 T052（027-08）。
- client、root build／lint 未跑（本張未改 client）；`pnpm lint` 會在 commit hook 執行。

**給後續 ticket 的備註**

- 04 隱藏登入：
  - `SuperUserAccessModule` 目前只匯出 `SuperUserConfigService`、`AuthSecurityEventService`；HTTP 端若要用 `SuperUserAccessService`，再加入 exports。
  - `currentEntry()` 會回入口原值，只能給 REPL 用。GET／POST 驗位置請直接讀 singleton（`find`／交易內 `findForUpdate`）比對 `entryKey`。
  - 開發庫已回到未初始化狀態。`server/.env` 的合成 `SUPER_USER_*` 密碼已丟棄，要展示登入時請重新產生 hash、改 `.env`，再用 REPL `initialize()`。
- 06 週輪換：
  - `rotateEntryIfDue` 用 `latestDueRotationPeriod(now)` 與 DB `period_start_at` 比較；`now` 由 service 傳入。
  - 輪換時列一定存在，`findForUpdate` 鎖的是既有列，沒有初始化時的空表 gap lock 問題。
  - REPL helper 加在 `repl.ts` 的 `createAuthConsole`，並沿用 `test/super-user-console.e2e-spec.ts`（`afterEach` 會刪 operator 事件與 singleton）。
  - `.env.test` 的 `DB_MYSQL_POOL_MAX=2`，同一個 app 內的並發測試最多同時開 2 個交易，否則會卡在等連線。
- 07 啟用帳密：`activateCredentials` 同樣加在 `createAuthConsole`；`credentialStatus().localConfigMatches` 就是啟用前的診斷值。generation 由 mysql2 以 number 回傳（`supportBigNumbers`＋`bigNumberStrings:false`）。
- 事件：初始化的兩筆事件 outcome 都用既有的 `succeeded`，沒有新增結果碼；`AuthSecurityOutcome` 白名單仍是同一處型別。
