# 05: worker 每天 04:00 自動執行匯入

**What to build:** worker 每天台北時間 04:00 自動執行 ticket 04 的匯入；部署多個 worker 也只會執行一次，停機錯過時恢復後補跑一次。成功、超過停用門檻與失敗都寫入不含個資的 log。

**Status:** resolved

**Blocked by:** [04-portal-user-sync-core](04-portal-user-sync-core.md)

**Size:** S

**Source:** [Spec](../../../specs/024-portal-hr-source/spec.md)、[Plan](../../../specs/024-portal-hr-source/plan.md)、[Tasks](../../../specs/024-portal-hr-source/tasks.md)、[Contracts](../../../specs/024-portal-hr-source/contracts/portal-source.md)。

**Scope:** T024–T025；US3 情境 1；FR-008；SC-006。

## Acceptance Criteria

- [x] 沿用 esign 既有的 BullMQ scheduler 寫法：scheduler id 為 `portal-user-sync:daily`、cron 為 `0 4 * * *`、時區為台北；queue 只在 worker 註冊。
- [x] 兩個 worker 連同一個 Redis 時，只有一個 scheduler，同一個 job 只處理一次；連續 7 天每天恰好觸發一次。
- [x] job 不重試；log 事件 `portal_users.sync_completed`、`portal_users.sync_blocked`、`portal_users.sync_failed` 只含摘要與分類，不含員編。
- [x] 相關的 lint、單元測試、build 與 e2e 通過，並附上實際結果與未驗證的限制；整合到 `feat/024-portal-hr-source` 並追加 commit 紀錄後，才可以改成 resolved。

## Comments & Implementation Results

2026-11-03：只建立 ticket，尚未實作。ready-for-agent 不代表可以忽略 Blocked by；前置 ticket 都 resolved 後才能開始。實作結果追加在這裡。

2026-11-03（implementer，branch `feat/024-t05`，commits `d84adab`、`4de7632`；合入 integration tip `a364905`（含 ticket 06），merge `a34f9fb`）：T024–T025 完成。

- 新增 `server/src/worker/users/`：
  - `portal-user-sync.constants.ts`：queue `portal-user-sync`、job `sync-portal-users`。
  - `portal-user-sync.scheduler.ts`（+ spec）：`onModuleInit` upsert `portal-user-sync:daily`，`{ pattern: '0 4 * * *', tz: TAIPEI_TIME_ZONE_ID }`，job 選項照 contract（`attempts: 1`、`removeOnComplete`／`removeOnFail` 1000）。
  - `portal-user-sync.processor.ts`（+ spec）：`@Processor(queue, { concurrency: 1 })`，呼叫 `run({ trigger: 'schedule', dryRun: false })`；不寫 log，錯誤原樣拋出，job 的 `failedReason` 就是已清理的 `PortalUserSyncError` 訊息。超過門檻時 service 回傳摘要並記 `sync_blocked`，job 視為完成。
  - `portal-user-sync-worker.module.ts`：import `PortalUserSyncModule`、`BullRootModule.register('worker')`（同 `EsignQueueModule` 的寫法）與 queue；只由 `WorkerModule` import。
- T025：新增 `server/test/portal-user-sync-worker.e2e-spec.ts`（3 個測試），`jest-e2e.json` 加入 `portal-user-sync-worker`；tasks.md 的 T025 路徑已同步。
  - worker 用正式的 `WorkerModule`，只把 `PortalUserSyncService` 換成替身（匯入本身由 `portal-user-sync.e2e-spec.ts` 驗證）。
  - 兩個 worker 同時啟動：Redis 只有一個 `portal-user-sync:daily`，pattern／tz／template 正確，只有 1 個 delayed job。從 Redis 中的 `next` 起，用 bullmq 匯出的 `defaultRepeatStrategy`（BullMQ 排下一次用的同一個函式，內含 cron-parser）推 7 次：都是台北 04:00:00.000、7 個連續日期、第一次在 24 小時內。沒有新增 dependency。
  - 停機錯過 04:00：以 mock 的 `Date.now` 在「前一天 03:00」用正式 scheduler 註冊，再同時啟動兩個 worker：`run` 只被呼叫 1 次，之後 `next` 是下一個台北 04:00，completed 1、delayed 1。
  - 失敗：`run` 拋 `PortalUserSyncError` → `attemptsMade` 1、不重試，`failedReason` 為清理過的訊息，隔天 04:00 仍排著。
- 與 research／contracts 不同或補充的決定（請 orchestrator 確認，並視需要更新 research §7 的 Rationale）：
  1. **錯過的 04:00 補跑**：research §7 寫「下一次排程會以延遲 job 的形式留在 Redis，恢復後執行一次」。但 BullMQ 5.81.5 的 `upsertJobScheduler`（override，`addJobScheduler-11.lua`）會刪掉該 scheduler 還沒執行的 job，改排下一個 04:00，所以 worker 重啟時 upsert 會把錯過的那一次丟掉（與 worker 取 job 互相競爭；照 research 的寫法，上面的 e2e 3 次有 2 次失敗）。scheduler 改成：`getJobScheduler` 的 `next` 已到期就不 upsert，讓 worker 補跑一次；開始執行時 BullMQ 從當下排下一個 04:00，不會補跑多次。未到期時照常 upsert，部署時仍會套用設定。修正後 e2e 連跑 8 次全過。
  2. 排程不存在時，BullMQ 對含冒號的 id 回傳 `next: null`（舊版 repeatable 的解析路徑），而不是 `undefined`；判斷改用 truthy，單元測試的 mock 也照實際回傳。
  3. `attempts: 1` 與 concurrency 1 照 contract 明寫；兩者都等於 BullMQ 預設（attempts 預設 0，也不重試；concurrency 預設 1）。
  4. **範圍外的測試修正**（`d84adab`）：把本 module 加進 `WorkerModule` 後，`esign-document-delivery-security` 每次都有 1–3 個案例失敗（document 停在 `finalizing`／匯出逾時）。
     - 原因：`finishCopy` 直接呼叫 `process()`，但同一個 worker context 裡真實的 finalization worker 可能先消費簽署時入列的 job、拿走 lease，直接呼叫就提前返回。
     - 佐證：基準 6/6 通過；加上本 module 4/4 失敗；基準 `WorkerModule` 在 init 尾端多 sleep 50ms 也 3/3 失敗，所以是啟動時序造成的競爭，不是功能互相影響。
     - 修正：`finishCopy` 等該 signer 離開 `processing` 後，再呼叫一次 `finalizeDocument`。結案是冪等的，同檔後段本來就會再呼叫並驗證證據不變。
     - 修正後：加上本 module 8/8、基準 2/2、基準加延遲 3/3 都通過。
- 驗證（合入 `a364905` 後）：
  - `pnpm -C server test -- src/worker/users`：5/5。
  - `pnpm -C server test`：117 suites／1207 tests 全過；pre-commit 與 pre-merge-commit hook 都通過。
  - `pnpm -C server lint:check`：0 errors；269 個 warnings 與基準相同，新檔沒有 warning。
  - `pnpm -C server build`：通過。
  - `pnpm -C server test:e2e`：
    - 本 ticket 與受影響的套件：`portal-user-sync-worker` 3/3、`portal-user-sync` 11/11、`mail-whitelist-worker` 17/17、`core-esign-flow-queue` 1/1、`esign-document-delivery-security` 3/3。
    - 全套 41/41 suites、437/437 tests。merge 後第一次全套中，`core-esign-flow`「10 人共用 3 欄位…」失敗 1 次（兩個 finalization 並行時 `saveSnapshot` 回報完整性錯誤）。這是 `specs/015-export-history/implementation-notes.md` 已記錄的既有偶發失敗；單獨跑 4/4 通過，第二次全套也全過。
  - 突變檢查：
    - 把 template 改成 `attempts: 2`：排程與失敗兩個 e2e 都會失敗。
    - 拿掉「已到期不覆寫」：補跑的 e2e 會失敗（job 被刪，`run` 不會執行）。
- 未驗證／限制：
  - 7 天是用 BullMQ 的下次執行時間計算推出來的，沒有實際跑 7 天。補跑與「只處理一次」是用模擬的錯過狀態加真實 Redis 驗證。
  - 任何啟動 `WorkerModule` 的 e2e 都會在測試 Redis 留下這個 scheduler（本檔結束時會 obliterate 自己的 queue，其他 worker 套件不會）。本機 Redis 若保留到隔天 04:00 之後才再跑 e2e，第一個啟動的 worker 會補跑一次，連到該測試檔的 `PORTAL_MYSQL_DB`。目前啟動 `WorkerModule` 的套件都不建合成 Portal，所以只會記一筆 `sync_failed`、job 失敗，不改資料。CI 的 Redis 每次都是新的。
  - worker 剛好在 04:00 整啟動時，`getJobScheduler` 與 upsert 之間若剛好到期，該次仍可能被換掉。這個毫秒級的時間窗沒有測。
  - worker 在匯入途中當掉時，BullMQ 的 stalled 機制（預設 `maxStalledCount` 1）會讓同一個 job 再跑一次，這不是 `attempts` 的重試，沒有測。
  - 同一個 IP 在 5 分鐘內反覆重跑 `esign-document-delivery-security`，會碰到 auth throttler（50 次／5 分鐘，存在 Redis）而回 429。這是重跑造成的，跟改動無關；驗證時有先清掉自己 DB 6 的 throttle key。

整合 commit：`191b83a`（feat/024-portal-hr-source）。
