# 04: 每日匯入核心：從 Portal 更新本機員工主檔

**What to build:** 一個可以重複執行的匯入服務，直接讀 Portal 更新本機 `users`：
- 沿用 023 的欄位規則；不合法或衝突的員編個別略過。
- 停用 Portal 明確標為非在職的人；Portal 查不到的不動，也不自動恢復。
- 單次停用超過 500 人時，整批不寫入。
- 在單一交易中鎖定後寫入，不留任何檔案。

**Status:** resolved

**Blocked by:** [01-portal-connection](01-portal-connection.md)

**Size:** L

**Source:** [Spec](../../../specs/024-portal-hr-source/spec.md)、[Plan](../../../specs/024-portal-hr-source/plan.md)、[Tasks](../../../specs/024-portal-hr-source/tasks.md)、[Contracts](../../../specs/024-portal-hr-source/contracts/portal-source.md)。

**Scope:** T020–T023；US3 情境 1–9、11、12；FR-008、FR-013；SC-005、SC-008、SC-009、SC-010。

## Acceptance Criteria

- [x] 5,001 位合成人員（含 4-byte 中文與前導零員編）的分類與寫入正確；同來源第二次執行實際變更 0 筆，`updated_at` 不變。
- [x] 缺姓名、Email 格式錯、欄位超長、員編不合法或同員編衝突的資料列，只略過該員編，其餘照常匯入；摘要依原因計數，log 中不出現這些員編。
- [x] Portal 有這個員編但沒有 0／1 資料列 → 停用；查無 → 不動；已停用或軟刪除 → 不恢復；剛好 500 人可以套用，501 人整批不寫入。
- [x] Portal 故障時本機變更 0 筆；寫入途中失敗不留部分結果；匯入交易進行中，同時有登入寫入同一員工時，登入等待匯入完成，沒有互相覆蓋。
- [x] 不改既有 ID、部門外鍵、登入紀錄與已發起文件的快照；執行前後工作目錄沒有新增檔案；哨兵欄位的值不出現在本機資料或 log 中。
- [x] 舊的 recovery e2e 已刪除，import e2e 只保留 repository 部分，e2e 允許清單同步更新。
- [x] 相關的 lint、單元測試、build 與 e2e 通過，並附上實際結果與未驗證的限制；整合到 `feat/024-portal-hr-source` 並追加 commit 紀錄後，才可以改成 resolved。

## Comments & Implementation Results

2026-11-03：只建立 ticket，尚未實作。ready-for-agent 不代表可以忽略 Blocked by；前置 ticket 都 resolved 後才能開始。實作結果追加在這裡。

2026-11-03（implementer，branch `feat/024-t04`，commit `b4227dc`；先後合入 integration tip `e8d9269`（merge `42803e7`）與 `d886b19`（含 ticket 07，merge `fba0c4d`））：T020–T023 完成。

- 新增：
  - `server/src/features/users/portal-user-sync.rules.ts`（+ spec）：純函式。
    - `normalizePortalEmployees(rows)` → `{ employees, skipped }`
    - `findDepartedEmpids(statuses)`
    - `planPortalUserSync(source, lockedUsers, departedEmpids)` → `{ operations, skipped }`
    - `isDeactivationBlocked(plan, confirmed?)`、`summarizePortalUserSync(plan, context)`
    - 常數 `PORTAL_USER_DEACTIVATION_LIMIT = 500`
  - `server/src/features/users/services/portal-user-sync.service.ts`：`PortalUserSyncService.run(options)`，以及 `PortalUserSyncError`。
  - `server/src/features/users/portal-user-sync.module.ts`：import `MysqlModule`、`PortalModule`，export `PortalUserSyncService`。
- 給 ticket 05／06 的 API：
  - `run({ trigger: 'schedule' | 'manual', dryRun: boolean, confirmedDeactivations?: number })` → `Promise<{ summary: PortalUserSyncSummary; skipped?: { empid, reason }[] }>`。
    - `summary` 欄位照 data-model；`outcome` 為 `applied`、`dry_run` 或 `blocked_deactivation_threshold`。
    - `skipped` 只在 dry-run 回傳，給 CLI 印到 stdout；不可寫進 log。
  - Portal 或本機 DB 失敗時，先記 `portal_users.sync_failed`，再拋 `PortalUserSyncError`（`stage: 'source' | 'write'`、`errorType`）。訊息與 stack 不含原始錯誤。
  - 三個 log 事件（`sync_completed`、`sync_blocked`、`sync_failed`）都由 service 記錄。processor 與 CLI 不必再記，以免重複。
  - 使用端要一起載入 `InfrastructureModule`（全域 LoggingModule 提供 `AppLoggerService`）與 `RequestIdClsModule`（LoggingModule 需要 `ClsService`），與 `WorkerModule` 相同。
- 流程：
  1. 交易外讀 Portal 4a。
  2. 讀本機在職者（`findActiveCandidates`），對不在 4a 名單（含被略過員編）中的人查 4b。
  3. 單一交易內，用 `findByEmpids`（不分大小寫）找出對應的本機列，連同要停用的人，以 `findByIdsWithEmail(ids, manager, true)` 依 id 遞增鎖定。
  4. 規劃後經 `UserRepository.save` 寫入；dry-run 與超過門檻時不寫入。
- T023：
  - 新增 `server/test/portal-user-sync.e2e-spec.ts`，共 8 個測試，使用獨立 schema 測試庫與合成 Portal。
  - 刪除 `portal-user-recovery.e2e-spec.ts`。
  - `portal-user-import.e2e-spec.ts` 只保留「Portal 主檔專用查詢」4 個 repository 測試。
  - `jest-e2e.json` 移除 `portal-user-recovery`，加入 `portal-user-sync`。
  - 舊的 `src/maintenance/portal-users*.ts` 與 CLI 未動，留給 ticket 06。
- 與 spec／research／data-model 不同或補充的決定（請 orchestrator 確認）：
  1. 本機已有只差大小寫的員編時，Portal 那一位算 `conflict` 略過。
     - 本機 `users.empid` 是 `utf8mb4_unicode_ci` 唯一鍵，建立會撞 `ER_DUP_ENTRY`，整批每天失敗。023 對這種情況是整批拒絕。
     - data-model 的 conflict 寫「員編只差大小寫」，沒說只限 Portal 內部，這裡延伸到本機。
  2. 失敗不回傳 `failed_source`／`failed_write` 摘要，改為拋出已清理的 `PortalUserSyncError`；這兩個 outcome 只出現在 `sync_failed` log。理由：
     - BullMQ job 會標成失敗，`failedReason` 是安全訊息。
     - CLI 可直接以非零碼結束。
  3. `eligibleEmployees` 指實際分類的員工數（create＋update＋noop＋protected），不含被略過的員編。
  4. 未超過門檻時忽略 `confirmedDeactivations`，與 contract「沒有超過門檻時，不需要這個參數」一致。research 寫「N 必須等於停用人數才會套用」，ticket 06 若要在未超過門檻時也檢查 N，需要 orchestrator 決定。
  5. dry-run 走同一個交易並取得同樣的鎖，只是不寫入。所以 dry-run 期間的登入寫入會短暫等待。
  6. 沒有沿用 023 的 NUL 字元檢查：data-model 沒列這條規則，也沒有對應的略過原因。
  7. 狀態查詢（4b）不分大小寫，只有員編精確相同才算「Portal 有這個人」。在職名單與狀態查詢之間恢復在職的人，不會被停用。
- 驗證（合入 integration tip 後重跑）：
  - `pnpm -C server test -- src/features/users/portal-user-sync.rules`：27/27。
  - `pnpm -C server test`：117 suites／1245 tests 全過；pre-commit 與 pre-merge-commit hook 也都通過。
  - `pnpm -C server lint:check`：0 errors；269 個 warnings 與基準相同，新檔沒有 warning。
  - `pnpm -C server build`：通過。
  - `pnpm -C server test:e2e -- portal-user-sync portal-user-import`：12/12（sync 8、import repository 4）。
  - `pnpm -C server test:e2e` 全套：40/40 suites、431/431 tests。
  - 合入 `d886b19` 後重跑：pre-merge hook（lint 0 errors；unit 115 suites／1200 tests，ticket 07 刪了部分 spec）、`pnpm -C server build`、`test:e2e -- portal-user-sync portal-user-import` 12/12。全套 e2e 是在 `e8d9269` 合入後跑的，ticket 07 合入後沒有重跑全套。
  - 突變檢查：分別拿掉 `FOR UPDATE`、拿掉門檻檢查、在 `sync_failed` log 加入原始錯誤訊息。每一種都會讓對應的 e2e 失敗，確認測試確實能抓到這些行為。
- e2e 涵蓋：
  - 5,001 人（4-byte 中文、全形符號、前導零）：
    - 第一次匯入：建立 4,999、更新 1、保護 1；舊 email 清除為 NULL。
    - ID、`department_id` 外鍵與 `last_login_at` 不變，`esign_signers` 快照列逐欄不變。
    - 第二次匯入：`users` 全表含微秒 `updated_at` 完全相同。
    - 執行前後工作目錄的檔案清單相同；哨兵值不出現在本機資料或 log。
  - 不合法與衝突：缺姓名、Email 格式錯、員編不合法、同員編資料不同、只差大小寫，都只略過該員編；完全相同的重複列合併。被略過員工的本機列不變，log 不含這些員編。
  - dry-run：不寫入，只回傳被略過的員編。
  - 停用：Portal 狀態 2、4／5 的人停用；查無、只差大小寫、已停用、軟刪除的帳號不動；Portal 恢復在職後也不自動恢復。
  - 門檻：
    - 501 人整批不寫入，記 `sync_blocked`。
    - 確認人數 500 仍擋；確認 501 才套用。
    - 剛好 500 人可套用。
  - Portal 故障：
    - `RENAME TABLE` 造成 `ER_NO_SUCH_TABLE`，錯誤密碼造成 `ER_ACCESS_DENIED_ERROR`，兩者本機都 0 變更。
    - log、錯誤訊息與 stack 都不含 Portal 主機、帳號、資料庫名稱或員編。
  - 寫入途中失敗：模擬 `ER_DUP_ENTRY` 且訊息含員編，整批回滾；錯誤與 log 都不含員編。
  - 登入同時寫入：
    - 匯入先寫完另一位員工、尚未 commit 時暫停，此時目標員工只靠 FOR UPDATE 鎖住。
    - 照 `findOrCreateUser` 的並行交易（`findByEmpidForUpdate` 後 `save`）等待超過 1 秒仍未完成；同時另一條連線看不到部分寫入。
    - 匯入 commit 後登入才寫入：最終保留匯入的部門與職稱，以及登入的姓名與時間。
- 未驗證／限制：
  - `too_long` 只有單元測試。Portal 每個欄位的長度上限都比本機短（姓名 50／100、部門代碼 11／50、部門名稱 40／150、職稱 20／100、Email 50／255），合成 Portal 用相同型別，無法產生超長資料；以 Portal 現有 schema，這個原因實際上不會出現。
  - 4b（狀態查詢）失敗沒有獨立的 e2e，與 4a 共用同一個錯誤分類路徑。
  - 沒有連真實 Portal；5,001 人只用本機 MySQL 測量（單次匯入約 1–2 秒）。

整合 commit：`dbdff39`（feat/024-portal-hr-source）。
