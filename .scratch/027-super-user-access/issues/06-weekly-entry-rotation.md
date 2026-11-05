# 06: 每週輪換隱藏入口並支援停機補做

**What to build:** 背景服務每週一台北 04:00 換新入口；維護者可透過同一 REPL 查詢結果，在服務停機或多實例競爭下仍只有一個有效網址，既有會話不被登出。

**Status:** resolved

**Blocked by:** [04-hidden-login](04-hidden-login.md)

**Source:** [Spec](../../../specs/027-super-user-access/spec.md)、[Plan](../../../specs/027-super-user-access/plan.md)、[Tasks](../../../specs/027-super-user-access/tasks.md)、[資料模型](../../../specs/027-super-user-access/data-model.md)、[API 行為](../../../specs/027-super-user-access/contracts/api-behavior.md)、[維運契約](../../../specs/027-super-user-access/contracts/operations.md)、[驗收指南](../../../specs/027-super-user-access/quickstart.md)。

**Scope:** T037、T038、T039、T040、T041、T042、T043、T044。

## Acceptance Criteria

- [x] 共用輪換服務鎖 singleton，以最近到期週期大於 DB 已處理週期才產新入口、增加 entry generation 並同交易寫事件；同週 no-op、不改 credential generation、不撤會話。
- [x] 只有獨立 worker 註冊週排程；固定 queue／scheduler／job、Asia/Taipei 週一 04:00、空 payload、3 次重試及既定 exponential backoff，保留最近 100 成功／失敗 metadata。
- [x] startup 先做 DB catch-up，再處理 overdue job／排程；停機多週只補一次，Redis 排程遺失、job 重試及多 worker 並發仍由 DB 仲裁。
- [x] 03:59:59／04:00、跨年、同週重啟、DB 故障與恢復有測試；失敗保留舊入口，未初始化不偷建帳號，不新增掃描排程或 production 時間設定。
- [x] 輪換後舊 GET／POST 立即 404，包括已開舊表單；輪換先 commit 則登入失敗，登入先 commit 的會話仍有效。
- [x] REPL 提供到期才輪換與白名單安全事件查詢（limit 預設 20、最大 100，beforeId 倒序），沒有任意強制輪換或 token 查詢；唯讀 helpers 不寫入。
- [x] 真正 REPL 的初始化並發、重複不覆寫、開發／建置模式與連線關閉通過；HTTP／Console 不註冊 queue、不啟動外部業務服務。
- [x] 完成週期、故障、競態與副作用驗收紀錄，未跑的停機環境情境明列限制。

## Comments & Implementation Results

### 2026-11-05 實作結果（分支 `027-06-weekly-entry-rotation`，程式 commit `f924a9f`）

**變更摘要（只有 server，無 client／migration／env 變更）**

- `SuperUserAccessService.rotateEntryIfDue(actor)`：交易內先 `findForUpdate` 鎖 singleton，`latestDueRotationPeriod(now)` 晚於 DB `period_start_at` 才換新入口（32 random bytes base64url）、`entry_generation +1`、更新 `rotated_at`／`period_start_at`，同交易寫 `entry.rotated`（outcome `succeeded`）。結果為 `{status:'rotated',entryGeneration}`、`{status:'not_due'}` 或 `{status:'uninitialized'}`，不含入口原值。不碰帳密版本與會話；未初始化不建列。`now` 在 service 內取，測試以 fake timers 控制。
- `SuperUserAccessRepository.save`（以 `manager.save` 維護 `updated_at`）、`AuthSecurityEventService.list`（交給既有 repository 檢查 limit 1～100、`beforeId` 倒序）。`SuperUserAccessModule` 多匯出 `SuperUserAccessService` 給 worker。
- `server/src/worker/auth/`：
  - constants：queue `auth-access-maintenance`、job `rotate-entry-if-due`。
  - processor：以 `system` 身分呼叫 `rotateEntryIfDue`，回傳值即 job 結果；未初始化記 `auth.entry_rotation_uninitialized` 警告並正常完成；失敗時 log `auth.entry_rotation_failed` 只帶錯誤代碼，再丟 `SuperUserEntryRotationError`「維護入口輪換失敗（<代碼>）」。原始 DB 錯誤可能夾帶 SQL 與參數（含未生效的新入口），不能進 Redis failedReason 或 worker 啟動失敗輸出。
  - scheduler：`onModuleInit` 先執行 processor 做 DB 補做（失敗讓 worker 啟動失敗），再沿用 Portal 每日匯入寫法：已到期未執行的 job 不覆寫，否則 upsert `super-user-entry-weekly`（`0 4 * * 1`、`Asia/Taipei`、`data:{}`、`attempts:3`、exponential 5000ms、`removeOnComplete/removeOnFail: 100`）。
  - `SuperUserAccessWorkerModule` 只由 `worker.module.ts` 載入。
- REPL：`createAuthConsole` 新增 `rotateEntryIfDue()`（`operator`，不接受參數）與 `securityEvents({limit,beforeId})`。
- 測試：新增 `super-user-access.service.spec.ts`、`worker/auth/*.spec.ts`、`test/super-user-entry-rotation.e2e-spec.ts`（加入 `jest-e2e.json` 白名單），擴充 `test/super-user-console.e2e-spec.ts`（含以 `pnpm -s repl:dev` 啟動兩個真正 REPL）。
- 文件：`tasks.md` T037～T044 標 `[X]` 並註明偏離；`contracts/operations.md` 補實作結果與失敗輸出；`quickstart.md` 新增「027-06」驗收記錄。

改到的共用檔案（與 027-07 可能衝突）：`server/src/console/repl.ts`（`createAuthConsole` 末尾兩個 helper）、`super-user-access.service.ts`（新型別與 `credentialStatus` 後的新方法）、`super-user-access.module.ts`（exports 與一行註解）、`super-user-access.repository.ts`（末尾 `save`）、`auth-security-event.service.ts`（`list`）、`test/super-user-console.e2e-spec.ts`（helper 清單斷言改為五個、模組排除清單、新增測試與檔尾 `startRepl`）、`test/jest-e2e.json`。沒有新增錯誤碼或安全事件種類／結果碼。

**驗證（實際指令與結果）**

- `pnpm -C server test`：129 suites／1286 tests 通過（新增 service 8、scheduler 4、processor 4）。
- `pnpm -C server test:e2e`：566 passed、1 skipped、1 failed（51 suites passed）。唯一失敗是既有 `api-coverage` 的 `GET /api/esign/documents/{id}/history`。新 `super-user-entry-rotation` 10 tests、`super-user-console` 14 tests 通過。
- `pnpm -C server test:e2e:security`：16 suites／117 tests；`pnpm -C server test:schema`：6 suites／39 tests，結束後無 `feastogether_intranet_test_b_*` 臨時庫殘留。
- `pnpm -C server lint:check`：0 errors、276 warnings（與 027-04 相同；新檔與改動檔 0 warning）；`pnpm -C server build` 成功。
- Mutation：輪換改用不鎖定的 `find`，e2e 3 tests 失敗；已還原。
- 週期邊界、故障、競態、REPL 副作用與 worker 實際排程的細節見 quickstart「027-06」。摘要：
  - 週期：03:59:59.999 no-op／04:00 輪換、跨年、同週再執行、停機多週只補一次、初始化後同週不輪換（單元）。
  - 故障：寫入失敗 rollback 保留舊入口（單元）；job 第一次 DB 失敗保留舊入口、失敗原因只有錯誤代碼、5 秒後重試只換一次（e2e，真 BullMQ）；未初始化 worker 照常啟動、job 回 `uninitialized`、不建列。
  - 競態：兩 worker 同時啟動、補做與錯過的 job、兩執行者同時輪換都只換一次；KDF 期間輪換先 commit 則登入 404；登入先鎖定並 commit 則輪換等待、會話仍有效。
  - 舊入口：輪換後舊 GET／POST 404（含已開表單），新入口 200，既有 Super user 會話仍有效。
  - 副作用：HTTP app 不註冊 queue／scheduler／processor、不寫 Redis 排程；Console 模組圖不含 worker module；真正 REPL（開發模式自動、建置模式手動）初始化並發只成功一次、重複不覆寫、查詢不寫入、`.exit` 後 exit 0 且連線 0 條、無 history 檔。
  - 實際 worker（開發庫 `feastogether_intranet_027b`、Redis 16321 DB 2）：`worker:dev` 停機兩週後啟動補做一次並註冊下週一 04:00 排程；同週重啟不換；刪 Redis 排程後重啟補做並重建；HTTP（3021）下舊入口 GET／POST 404、新入口 200。
- 環境處理：沒有修改 `server/.env`。Portal pool 是第一次查詢才連線，Redis DB 2 原本為空，Portal 每日匯入排程下次在 2026-11-06 04:00，驗證期間未到期、未查 Portal。驗證後已刪除開發庫的 singleton 與事件，清空 Redis DB 2，停止所有自己啟動的 worker、HTTP 與 REPL。

**未驗證／限制**

- 停機情境都是模擬（DB 已處理週期往前推、刪 Redis key、注入 DB 錯誤），沒有在 UAT 實際停機跨過週一 04:00，也沒有測 Redis 故障切換或多台主機。
- 每個 worker 用自己的時鐘判斷到期，主機需 NTP 對時。
- 週一 04:00 DB 不可用超過重試窗（約 5＋10 秒）時，job 最終失敗後不再自動嘗試，要等下次 cron 或 worker 重啟補做；可從 failed job 與 log 看到，維護者可用 REPL `rotateEntryIfDue()` 補做。這是契約既定的 3 次重試與「不增加掃描排程」。
- 啟動補做失敗會讓整個 worker（含電子簽與 Portal processor）無法啟動。DB 不可用時 TypeORM 初始化本來就會讓 worker 起不來，所以實際差異只在輪換專屬的故障（例如未套 migration）。規格沒寫這點，原採 fail-fast；使用者決定改成記 log 後照常啟動（見下方「後續」）。
- 非 TTY 一次輸入多行時，REPL 不等前一行 `await` 完成就執行下一行，`.exit` 可能在查詢完成前關閉連線池（027-03 既有行為，未修改）；逐行執行沒有此問題。
- `nextScheduledAt` 語意未改（仍為已處理週期＋7 天）。

**給 ticket 08 的備註**

- worker 現在會載入 `SuperUserAccessModule`，啟動時同樣驗證 `SUPER_USER_ACCOUNT`／`SUPER_USER_PASSWORD_HASH`。UAT 的 worker 與 HTTP 共用 `server.env`（`docker-compose.uat.yml` 的 `x-backend`），補設定時兩者一起生效；缺設定時 worker 會因 `restart: unless-stopped` 反覆重啟。
- 部署順序沿用 operations：migration → REPL `initialize()` → 新 HTTP／worker。worker 若先於 `initialize()` 啟動，只記 `auth.entry_rotation_uninitialized` 警告；初始化後要等下次 cron 或重啟才會再檢查，初始化本身已把當週設為已處理，不影響結果。
- 文件要寫：需要立即補做時用 REPL `await auth.rotateEntryIfDue()`，不要用 BullMQ `promote()` 提前執行排程 job（BullMQ 會從原排定時間算下一次，等於跳過一週）。REPL 指令要逐行執行、等結果出來再輸入下一行。
- 觀測：輪換結果在 `auth_security_events`（`entry.rotated`，actor `system`／`operator`）、singleton 的 `rotated_at` 與 `period_start_at` 差即排程延遲；Redis 保留最近 100 筆成功／失敗 job；失敗 log 為 `auth.entry_rotation_failed`（只有錯誤代碼）。

### 後續（使用者決定）

- 2026-11-05 使用者決定：啟動補做失敗時記 log 後照常啟動，不採 fail-fast。
- `SuperUserAccessScheduler.onModuleInit` 改為忽略補做的失敗（processor 已記 `auth.entry_rotation_failed`，只帶錯誤代碼），照常查 Redis 並註冊排程。電子簽與 Portal processor 不再因輪換專屬故障（例如未套 migration）停擺；輪換等下次 cron，或由維護者以 REPL `auth.rotateEntryIfDue()` 補做。DB 不可用時 TypeORM 初始化仍會讓 worker 起不來，與原本相同。
- 部署檢查因此要看 worker log 有沒有 `auth.entry_rotation_failed`，不能只看 worker 是否啟動。
- 測試：`super-user-access.scheduler.spec.ts` 的補做失敗案例改為驗證照常啟動並註冊排程。

### 整合紀錄

已合入整合分支 `027-super-user-access`（2026-11-05，fast-forward）：
- `f924a9f feat(auth): 每週一台北 04:00 輪換維護入口，worker 啟動補做並由 DB 週期仲裁`
- `875f47f docs(tickets): 記錄 027-06 週輪換實作結果、驗證與限制`
- `7769e73 fix(worker): 維護入口啟動補做失敗時記 log 並照常啟動`

7769e73 是使用者決定的後續：啟動補做失敗改為記 log 後照常啟動。
