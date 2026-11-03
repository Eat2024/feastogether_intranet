# 01: Portal 唯讀連線基礎

**What to build:** server 有一個共用的 Portal 唯讀連線：設定由 `PORTAL_MYSQL_*` 環境變數提供，第一次查詢時才連線，所以 Portal 故障不影響服務啟動。只執行合約列出的四個查詢；另有合成 Portal 測試資料庫，供後續 tickets 使用。

**Status:** resolved

**Blocked by:** 無（可以立即開始）

**Size:** M

**Source:** [Spec](../../../specs/024-portal-hr-source/spec.md)、[Plan](../../../specs/024-portal-hr-source/plan.md)、[Tasks](../../../specs/024-portal-hr-source/tasks.md)、[Contracts](../../../specs/024-portal-hr-source/contracts/portal-source.md)。

**Scope:** T001–T006；FR-001、FR-002、FR-003，以及 FR-012 的 `.env.example` 部分。精確檔案與測試入口見 tasks 對應的 ID。

## Acceptance Criteria

- [x] `.env.example` 列出五個 `PORTAL_MYSQL_*` 與所需的最小 SELECT 權限，不含任何實際值。
- [x] 送出的 SQL 與合約逐字相同；沒有寫入語句，也不讀密碼、身分證字號、生日欄位（單元測試鎖定）。
- [x] 連線池最多 3 條連線，連線與查詢逾時各 10 秒；Portal 不回應時 15 秒內拒絕。
- [ ] 設定缺漏或 Portal 無法連線時，HTTP app 仍能啟動，查詢時才失敗，錯誤訊息不含設定值。
- [x] 合成 Portal 測試資料庫只建在 `feastogether_intranet_test` 前綴下，測完自動刪除；4-byte 中文與前導零員編完整讀回，哨兵欄位的值不出現在任何查詢結果中。
- [x] 相關的 lint、單元測試、build 與 e2e 通過，並附上實際結果與未驗證的限制；整合到 `feat/024-portal-hr-source` 並追加 commit 紀錄後，才可以改成 resolved。

## Comments & Implementation Results

2026-11-03：只建立 ticket，尚未實作。ready-for-agent 不代表可以忽略 Blocked by；前置 ticket 都 resolved 後才能開始。實作結果追加在這裡。

2026-11-03（implementer，branch `feat/024-t01`，commit `8146002`）：T001–T006 完成。

- 新增 `server/src/infrastructure/portal/`：
  - `portal.config.ts`：延遲讀 `PORTAL_MYSQL_*`。
  - `portal.types.ts`
  - `portal-directory.service.ts`：mysql2 pool，第一次查詢才建立；utf8mb4、3 條連線，連線與查詢逾時各 10 秒；四個合約查詢；4b 每批 500 個；模組銷毀時 `pool.end()`。
  - `portal.module.ts`
- `server/.env.example` 新增五個 `PORTAL_MYSQL_*`（只寫佔位與最小 SELECT 權限說明）。
- 測試：
  - `test/synthetic-portal.helper.ts`
  - `test/portal-directory.e2e-spec.ts`（已加入 `jest-e2e.json` 允許清單）
  - `test/setup-e2e.ts` 新增 Portal env 指向（見下方決定 2）。
- 與 plan／research／contract 不同的決定：
  1. `PORTAL_MYSQL_PASS` 允許留空（contract 寫必填）：本機測試 MySQL 的 root 是空密碼，`.env.test.example` 的 `DB_MYSQL_PASS` 也是空的，合成 Portal 沿用 `DB_MYSQL_*` 時必填會讓 e2e 失敗。HOST、USER、DB 仍然必填，因為缺漏時 mysql2 會默默改連 localhost 或用空帳號。
  2. `PORTAL_MYSQL_*` 改由 `test/setup-e2e.ts` 在每個測試檔載入前無條件指向 `${DB_MYSQL_DB}_portal_<8 碼>`，不是由 helper 在 `beforeAll` 設定。原因：`ConfigModule.forRoot` 在 import 時把 `process.env` 與 `server/.env` 存成驗證後設定，`ConfigService.get` 會優先讀它；若開發者的 `.env` 有真實 Portal 設定，helper 之後改 env 不會生效，e2e 會連到真實 Portal。
  3. 臨時庫名用 8 碼隨機而非完整 uuid：MySQL 名稱上限 64 字元。
  4. 4b 依批次展開成 `IN (?, ?, …)`，對應合約的 `(?, ...)`。
- 驗證：
  - `pnpm -C server test -- src/infrastructure/portal`：9/9。
  - `pnpm -C server test`：114 suites／1181 tests 全過（pre-commit hook 亦通過）。
  - `pnpm -C server lint:check`：0 errors；269 個 warnings 都在既有檔案，新檔沒有。
  - `pnpm -C server build`：通過。
  - `pnpm -C server test:e2e -- portal-directory`：3/3。涵蓋四個查詢的實際回傳、二進位排序、4-byte 中文／罕用字／前導零員編、collation 不分大小寫、哨兵值不外流；設定缺漏時 app 照常啟動、查詢才拒絕；不回應 server 約 10 秒拒絕。
  - `pnpm -C server test:e2e:security`：14/14 suites、84/84。
  - `pnpm -C server test:e2e` 全套：32/40 suites、368/407 tests，8 個失敗 suite 都不是本變更造成：
    - 7 個（esign-audit-batch、mail-whitelist-recovery、mail-whitelist-worker、notification-bulk-insert、portal-user-import、portal-user-recovery、signer-batch-insert）：`withSchemaTestDatabase` 產生 `${DB_MYSQL_DB}_<32 碼>`，worktree 的庫名 `feastogether_intranet_test_024_t01` 使它超過 64 字元。換回 baseline 的 `setup-e2e.ts` 跑 signer-batch-insert 同樣 3/3 失敗。
    - internal-email-capacity：5,001 人測試超過 180 秒逾時，應是同一台 MySQL 的負載造成。
    - 以 `DB_MYSQL_DB=feastogether_intranet_test_t01` 重跑這 8 個 suite：8/8、45/45 全過。
- 未驗證／限制：
  - 沒有連真實 Portal，只用合成資料。
  - e2e 只驗證「不回應 server」的連線逾時。查詢逾時（server 完成 handshake 後不回應）只由單元測試鎖定 `timeout: 10_000` 參數。
  - 15 秒上限只在每個 process 同時不超過 3 個查詢時成立。mysql2 pool 沒有 acquire timeout，連線失敗時一次只放行一個排隊者。實測 Portal 不回應、7 個並發查詢：3 個 10 秒、3 個 20 秒、1 個 30 秒才拒絕。是否需要整體期限，由 orchestrator 決定。
  - mysql2 的錯誤訊息可能含 Portal 主機或帳號，server 錯誤的 `err.sql` 含代入後的員編。後續 tickets 不可把原始錯誤或 error 物件寫進 log 或回應。

2026-11-03（orchestrator 決定後補做，commit `b575371`）：
- 每次 SQL 查詢加 10 秒整體期限（計時器 race，涵蓋排隊等連線）。
- `PORTAL_MYSQL_PASS` 可為空，已改 contract 與 research §1／§3。
- Portal 不可用時 `pool.end()` 會拒絕，`onModuleDestroy` 改為只記錯誤代碼、不阻擋關閉。
- 驗證：
  - `pnpm -C server test -- src/infrastructure/portal`：12/12。
  - `pnpm -C server test`：114 suites／1184 tests 全過（pre-commit hook）。
  - `pnpm -C server lint:check`：0 errors。
  - `pnpm -C server build`：通過。
  - `DB_MYSQL_DB=feastogether_intranet_test_t01 DB_MYSQL_PASS= pnpm -C server test:e2e -- portal-directory`：3/3，含 7 個並發查詢對不回應 server 全部在 15 秒內拒絕（約 10 秒）。
- 限制：期限以「每個 SQL 查詢」計。`listOrgChartSource` 依序跑兩個查詢；Portal 慢但有回應時最多約 20 秒，不回應時第一個查詢 10 秒就拒絕。`findStatusesByEmpids` 每批各自 10 秒。

整合 commit：`3402324`（feat/024-portal-hr-source）。
