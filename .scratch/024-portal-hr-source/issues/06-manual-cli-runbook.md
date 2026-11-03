# 06: 手動匯入 CLI 與 runbook 改寫

**What to build:** 維運人員可以隨時手動執行一次匯入，規則與每日匯入相同：
- `sync --dry-run`：只預覽摘要、被略過的員編與要停用的人數，不寫入。
- 正式執行：停用人數超過門檻時，必須帶 `--allow-deactivations <N>`，且 N 等於本次停用人數。

023 的 HEX TSV 檔案輸入、預覽檔、原值檔與 rollback 全部移除；runbook 改寫成每日自動匯入的維運說明。

**Status:** claimed

**Blocked by:** [04-portal-user-sync-core](04-portal-user-sync-core.md)

**Size:** M

**Source:** [Spec](../../../specs/024-portal-hr-source/spec.md)、[Plan](../../../specs/024-portal-hr-source/plan.md)、[Tasks](../../../specs/024-portal-hr-source/tasks.md)、[Contracts](../../../specs/024-portal-hr-source/contracts/portal-source.md)。

**Scope:** T026–T028；US3 情境 10；FR-009、FR-012（runbook）。

## Acceptance Criteria

- [x] CLI 只接受上述兩種指令，結束碼照合約；不接受 `--input`、`--output`、`--exclude-file`、`--acquired-at` 與 rollback 指令。
- [x] dry-run 不寫入；被略過的員編只輸出到 stdout，不寫入 log。
- [x] 超過門檻時，不帶參數或 N 不符都以非零狀態結束且不寫入；N 相符才套用。
- [x] 023 的 source、import、store、recovery 程式檔已刪除，不保留檔案輸入作為替代來源。
- [x] runbook 說明每日 04:00 匯入、如何查看 log、dry-run 與確認步驟、第一次上線超過門檻的處理、Portal 故障時的處理；不含 HEX 匯出、搬檔或回復步驟，也不寫真實員編、主機或帳密。
- [ ] 相關的 lint、單元測試、build 與 e2e 通過，並附上實際結果與未驗證的限制；整合到 `feat/024-portal-hr-source` 並追加 commit 紀錄後，才可以改成 resolved。

## Comments & Implementation Results

2026-11-03：只建立 ticket，尚未實作。ready-for-agent 不代表可以忽略 Blocked by；前置 ticket 都 resolved 後才能開始。實作結果追加在這裡。

2026-11-03（implementer，branch `feat/024-t06`，commit `9bc2ced`、`66eddb7`；基於 integration tip `f5ae5c8`）：T026–T028 完成。

- CLI（T026）：
  - `server/src/maintenance/portal-users.ts`：`NestFactory.createApplicationContext` 載入 `RequestIdClsModule`、`InfrastructureModule` 與 `PortalUserSyncModule`（module 定義在同檔，不含 scheduler），以 `trigger: 'manual'` 呼叫 `PortalUserSyncService.run`；Nest logger 只留 error／warn。
  - `server/src/maintenance/portal-users.args.ts`：純函式 `parsePortalUsersArgs`，只接受 `sync --dry-run`、`sync`、`sync --allow-deactivations <N>`（N 為非負整數）。獨立成檔是因為載入 `InfrastructureModule` 時 `ConfigModule.forRoot` 會立即驗證環境變數，單元測試無法 import CLI 本體。
  - stdout：`摘要：<JSON>`；dry-run 另外輸出每個 `略過：<員編>（<原因>）` 與 `要停用：<N> 人`。log 事件由 service 寫出，CLI 不重複記錄。
  - 結束碼：成功與 dry-run 為 0；參數錯誤（stderr 印用法）與超過門檻未確認（stderr 印停用人數與要帶的 `--allow-deactivations <N>`）為 1。`PortalUserSyncError` 不攔截，由 Node 以 1 結束並印出已清理的訊息與 stack。
  - 刪除 `portal-users-source.ts`、`portal-users-import.ts`、`portal-users-store.ts`、`portal-users-recovery.ts`；`portal-users.spec.ts` 改為 18 個參數表格測試（3 種接受、15 種拒絕，含 `--input`、`--output`、`--exclude-file`、`--acquired-at`、preview／apply／rollback 指令）。
- CLI e2e（T027，`server/test/portal-user-sync.e2e-spec.ts` 新增 3 個測試；未改 `jest-e2e.json`）：
  - 以子程序執行 CLI 原始碼（`node --conditions=development -r ts-node/register src/maintenance/portal-users.ts`），主 DB 指向本檔的 schema 測試庫，`LOG_LEVEL=info`；每次約 1 秒。這樣也驗證了 Nest context 的組裝與程序會自行結束（60 秒逾時即失敗）。
  - dry-run：結束碼 0、`users` 全表不變；stdout 有摘要 JSON、略過行與停用人數；log（同在 stdout）有 `sync_completed`，但被略過的員編只出現在 CLI 的那一行。
  - 501 人停用：`sync` 與 `--allow-deactivations 500` 都以 1 結束、stderr 提示 501、全表不變；`--allow-deactivations 501` 結束碼 0 並全部停用。
  - `sync --input …`、`rollback …` 以 1 結束並印用法；Portal 資料庫不存在時以 1 結束、log 有 `sync_failed`；本機都沒有寫入。
  - 突變檢查：把略過清單加進 `sync_completed` 的 metadata、把超過門檻的結束碼改成 0，對應測試都會失敗。
- Runbook（T028，`server/docs/portal-user-import.md` 全部改寫）：設定、匯入規則、每日 04:00 與 `docker logs … | grep portal_users.sync_`、三個 log 事件與摘要欄位、手動 dry-run／正式執行、第一次上線超過門檻的處理、Portal 故障與 `failed_write` 的處理、資料錯誤（無回復）。不含 HEX 匯出、搬檔、rollback、真實員編、主機或帳密。
- 與 spec 不同或需要 orchestrator 確認：
  1. `--allow-deactivations` 只在停用人數超過門檻時需要（依決定）。research §6 與 data-model「帳號啟用狀態的轉換」原句可讀成「一律要相符」，已改寫。
  2. Runbook 的 UAT 指令在 contracts 的指令上加了 `--env-file /dev/null`，並先載入 `releases/current.env`：`docker-compose.uat.yml` 的 `${SERVER_IMAGE:?…}` 沒有設定就無法執行，做法照 `docs/deployment/uat-cicd.md`「人工操作」。contracts、research §8 與 quickstart 的指令沒有這兩步，是否同步更新請決定。
  3. plan「UAT 上線前置」與 quickstart 寫「先確認名單」，但依 contracts，CLI 只輸出停用人數，不列出要停用的員編。Runbook 改寫成「對照人資提供的離職人數確認 N 合理」。若需要名單，要另外決定輸出方式（同樣只能到 stdout）。
  4. 參數解析沒有用 `util.parseArgs`：只有三種固定寫法，用 parseArgs 仍要另外檢查位置參數、互斥與整數，還要攔截它自己的錯誤，沒有比較簡單。
  5. 所有失敗的結束碼都是 1（contracts 只要求非零）。
- 驗證：
  - `pnpm -C server test -- src/maintenance`：18/18。
  - `pnpm -C server test`：115 suites／1202 tests 全過；兩次 commit 的 pre-commit hook 都通過。
  - `pnpm -C server lint:check`：0 errors，269 warnings 與基準相同，新檔與改動檔沒有 warning。
  - `pnpm -C server build`：通過，產出 `dist/maintenance/portal-users.js`（與 `portal-users.args.js`），舊的四個 dist 檔已不存在。
  - 用建置後的 `node dist/maintenance/portal-users.js sync --dry-run` 對本機測試 DB 與臨時合成 Portal 庫手動跑一次：輸出摘要、略過行與停用人數，結束碼 0，本機沒有寫入；臨時庫已刪除。
  - `pnpm -C server test:e2e portal-user-sync portal-user-import`：15/15（sync 11、import repository 4）。
- 未驗證／限制：
  - 沒有在 UAT 執行 `docker compose … run --rm worker …`，也沒有連真實 Portal；`intranet-uat-worker-1` 是依 Compose 命名規則推得的容器名稱。
  - Runbook 的每日 04:00、多 worker 只執行一次與停機後補跑，依賴 ticket 05（尚未合入）。
  - e2e 的子程序依賴 ts-node（devDependency）與 `--conditions=development`，與 package.json 既有的 typeorm／db 指令相同。

