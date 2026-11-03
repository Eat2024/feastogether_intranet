# 研究紀錄：Portal 直連取代饗賓人人資查詢

以下事實於 2026-11-03 查證：程式碼依 `dev`（`1ab6b99`，已含 Spec 023）；Portal 資料以唯讀帳號查詢 `information_schema` 與彙總筆數，未讀取個資。

## 0. 已查證的 Portal 事實

- MySQL 8.0.31，`@@max_connections` 為 151，由多個系統共用。
- `sys_person`（表 collation `utf8mb4_unicode_ci`）：
  - `person_empid varchar(20)`、`department_id varchar(11)`、`department_name varchar(40)`、`title varchar(20)`、`email varchar(50)`，皆為 `NOT NULL utf8mb3_general_ci`。
  - `person_name varchar(50) NOT NULL utf8mb4_unicode_ci`；`person_status int NOT NULL`。
  - `person_empid` 有索引。
- `chi_department`（`utf8mb3_general_ci`）：
  - `department_ch_id varchar(20)`（有索引）、`department_name varchar(50)`、`department_parent_guid varchar(100)`、`startdate varchar(20)`，皆 `NOT NULL`；`stopdate varchar(20) NULL`。
  - 根部門的上層代碼是空字串，不是 NULL。
- 人員狀態分布：0 試用 11、1 正式 5,155、2 共 31,130、4 共 333、5 共 28、8 共 49。
  - 在職（0／1）5,166 人，員編沒有重複。
  - 沒有員編同時有在職與非在職資料。
- 部門：共 2,618 筆，未停用 1,077 筆；未停用部門沒有重複代碼。
- 在職資料品質：1 筆姓名空白，Email 有值 613 筆且格式都合法，員編與部門代碼格式都合法。
- 離職量（2025-11 至 2026-11，以離職日計）：
  - 每月 146–312 人。
  - 有人離職的日子平均每日 7.8 人。
  - 單日最高 174 人（2026-02-28），其次 128、119，都是月底。

## 1. Portal 連線實作

- **Decision**：用既有 dependency `mysql2`（^3.18.2）的 promise pool，不另建 TypeORM DataSource。
  - `charset: 'utf8mb4'`
  - `connectionLimit: 3`
  - `connectTimeout: 10_000`
  - 每個查詢帶 `timeout: 10_000`
  - 每次呼叫再以計時器 race 出 10 秒的整體期限，涵蓋排隊等連線（實作時補上，見下方 Rationale）
  - 模組銷毀時呼叫 `pool.end()`；Portal 不可用時 `end()` 會拒絕，只記錯誤代碼，不阻擋其他模組關閉
- **Rationale**：
  - Portal 只有四個固定的唯讀 SELECT，沒有 entity 或 migration。
  - mysql2 pool 在第一次查詢才建立連線，Portal 故障不會影響 HTTP 與 worker 啟動（FR-003），Portal 恢復後也會自動重連。
  - 主 DB 的 provider 在啟動時呼叫 `initialize()`，失敗後吞錯、留下未初始化的 DataSource 且不重試，不適合用在 Portal。
  - 10 秒逾時可滿足 SC-007「15 秒內回報」。但 mysql2 pool 沒有 acquire timeout，連線失敗時一次只放行一個排隊者：實測 Portal 不回應、7 個並發查詢分別在 10、20、30 秒才拒絕。所以每次呼叫另加 10 秒整體期限，讓排隊中的呼叫也在 15 秒內回報。
  - 連線上限 3 是因為 Portal 由多系統共用，`max_connections` 只有 151。
- **Alternatives considered**：
  - 第二個 TypeORM DataSource：啟動時就要連線，還要處理 entity 與生命週期，多了不必要的複雜度。
  - 透過 oauth 系統提供 API：新增跨系統依賴，與「直連 Portal」的決策不符。
  - TLS：Portal 走內網，同主機的 oauth worker 目前也不加密，本次不加。

## 2. 模組位置與設定

- **Decision**：新增 `server/src/infrastructure/portal/`，與 `database/` 同層：
  - `portal.config.ts`：用 ConfigService 讀環境變數；照 `FeastogetherConfig` 的方式，在第一次使用時才檢查必填值。
  - `portal-directory.service.ts`：持有 pool，提供四個查詢方法。
  - `portal.module.ts`：匯出上面兩者。
- 由需要的 feature module 自行 import：AuthModule、EsignModule、每日匯入模組。不放進 `InfrastructureModule`，以免沒有用到的 process 也帶著設定依賴。
- 設定缺漏時，在第一次查詢拋出一般 Error，由呼叫端轉成各自既有的錯誤碼，不新增 AppError。
- **Rationale**：
  - 三個 feature 都需要這個連線，符合憲章 IV「確實跨 feature 重用才進共用層」。
  - 延後到使用時才檢查設定，可讓啟動不受影響。這也是 repo 中饗賓人設定的既有做法。

## 3. 環境變數

- **Decision**：新增下列五個變數，命名與 `DB_MYSQL_*` 一致：

  | 變數 | 說明 |
  | --- | --- |
  | `PORTAL_MYSQL_HOST` | Portal 主機 |
  | `PORTAL_MYSQL_PORT` | 埠，預設 3306 |
  | `PORTAL_MYSQL_USER` | 帳號 |
  | `PORTAL_MYSQL_PASS` | 密碼，可為空（與 `DB_MYSQL_PASS` 相同） |
  | `PORTAL_MYSQL_DB` | 資料庫 |

  - 連線上限與逾時是程式常數，不開成環境變數。
  - 不加入 `validateAppEnvironment`。
  - UAT 使用 `survey_role`，值寫在主機的 `server.env`，由維運設定。
- **Rationale**：這是 spec 明確要求的新設定；其餘參數沒有需要調整的實際情境。

## 4. 選人部門樹

- **Decision**：
  - `PortalDirectoryService.listOrgChartSource()` 照 fgapi 的 SQL 執行兩個查詢，排序也在 SQL 做，以保留現行的排序結果：
    - 部門：`stopdate IS NULL`，依 `CAST(department_name AS BINARY), department_ch_id` 排序。
    - 員工：`person_status = 1`，依 `person_empid` 排序。
  - 組樹邏輯從 fgapi 的 `OrgChartBuilder` 移植成純函式 `features/esign/services/org-chart.builder.ts`：
    - 上層代碼為空字串時視為 null。
    - 上層不存在或已停用的部門當成根節點。
    - 對不到部門的員工不列入並計數。
    - 部門代碼空白或重複、形成循環、深度超過 100 層時拋錯。
  - `OrgDepartmentDto` 與 `parseOrgChart` 從 `infrastructure/http-client/feastogether/types/org-chart.dto.ts` 搬到 `features/esign/dto/org-chart.dto.ts`，繼續用來驗證快取讀出的資料。
  - 快取 key 前綴維持 `esign:org-chart:v2:`。命名空間的 hash 來源由 `[NODE_ENV, feastogetherBaseUrl]` 改為 `[NODE_ENV, 'portal', host, port, db]`，切換後舊快取自然不再命中。
  - Portal 錯誤或組樹失敗一律回傳 `ORG_CHART_UPSTREAM_UNAVAILABLE`（502），不寫快取。
  - `EsignModule` 改為 import `PortalModule`，不再 import `FeastogetherModule`。
- **Rationale**：照抄 fgapi 的規則，才能滿足 SC-002 的 100% 一致。fgapi 的五個測試情境（多層樹與未對應人數、空資料、不合法樹不快取、來源失敗不快取、授權）都移植成單元與 e2e 測試。
- **Alternatives considered**：
  - 在 JS 端排序：Portal 的 collation 不分大小寫，JS 排序容易和現行結果不同。
  - 兩個查詢包在同一個交易：fgapi 有這樣做，但兩個查詢之間的差異頂多讓一位員工暫時對不到部門，30 分鐘後就會更新，不值得增加交易處理。

## 5. 登入時的員工資料

- **Decision**：新增 `features/auth/services/eligible-staff.service.ts`，方法 `lookupEligibleStaff(empId)` 的簽名與回傳型別都跟現在相同：
  - 查詢：`PortalDirectoryService.findEmployeesByEmpid(empId)`，條件是 `WHERE person_empid = ?`，有索引。
  - 精確比對：Portal 的 collation 不分大小寫，也忽略尾端空白，所以查回來後再用 `===` 比對員編。
  - 篩選：狀態必須是 0／1，而且剛好一筆。
  - 正規化：Portal 的 `person_name`、`department_id`、`department_name`、`title` 是 `NOT NULL DEFAULT ''`，驗證前先 trim，空字串轉為 null（與 fgapi `SyncUsersFromPortal` 相同）；員編不 trim，尾端空白不算相符。查詢已改為精確相等（`WHERE person_empid = ?`），只驗證選中的那一筆；舊的 LIKE 查詢只要任一筆不合法就整批拒絕。
  - 驗證：轉成既有的 `StaffLookupDto`（搬到 `features/auth/dto/`），沿用既有的 class-validator 規則；`person_status_name` 由狀態推得，0 為「試用」、1 為「正式」。
  - 錯誤：Portal 失敗回傳 `STAFF_LOOKUP_FAILED`，資料不合格回傳 `AUTH_EXCHANGE_FAILED`，都與現行相同。
- `auth.service.ts`（帳密登入、WebView）與 `oauth-identity.service.ts` 只需要換注入的服務，寫入本機的邏輯不變。
  - 這兩處都不會寫本機部門外鍵 `departmentId`。
  - OAuth 流程不會寫入 `personStatus` 與 `titleName`。
- **Rationale**：只換資料來源，不碰登入流程，符合 FR-006 與 FR-007。
- **Alternatives considered**：把資格規則放在 `infrastructure/portal`。但目前只有 auth 會用到，規則應放在最靠近業務的 feature。

## 6. 每日匯入的核心

- **Decision**：把 023 的匯入邏輯搬成 Nest 服務，讓 worker 與 CLI 共用：
  - 純函式放在 `features/users/portal-user-sync.rules.ts`：
    - 正規化：沿用 `parsePortalUsers` 的欄位規則，但輸入改為查詢結果的資料列。
    - 規劃：`planOperations` 的 create、update、noop、protected，再加上 deactivate。
    - 彙總：`summarize`。
  - I/O 放在 `features/users/services/portal-user-sync.service.ts`。
- 不合法或衝突的資料列改為個別略過並依原因計數，原因包括：
  - `missing_name`
  - `invalid_email`
  - `too_long`
  - `invalid_empid`
  - `conflict`：同員編資料不同，或只有大小寫不同
- 被略過的員編不更新也不停用。
- 單次執行的步驟：
  1. 讀 Portal 在職名單。
  2. 對本機在職、但不在 Portal 在職集合中的員編，每批 500 個向 Portal 查狀態。
  3. 在單一交易中，依 id 遞增 `FOR UPDATE` 鎖定既有資料列，並檢查新員編。
  4. 規劃並寫入，透過 `UserRepository.save` 留下稽核。
  5. commit。
- 移除的部分：
  - preview 與 apply 兩段式流程、原值比對。
  - `.intent`／`.prepared`／result 檔，以及所有檔案的讀寫。
  - `--acquired-at`、排除檔、回復功能。
- 停用：本機 `is_active = true`、未刪除，且 Portal 有這個員編、但沒有任何 0／1 資料列的人，設為 `is_active = false`。Portal 查不到的人不動。匯入永遠不會把 false 改回 true。
- 停用門檻：常數，每次 500 人。
  - 超過時，每日匯入整批不寫入並記錄 log。
  - 超過時，CLI 要帶 `--allow-deactivations <N>`，而且 N 必須等於本次算出的停用人數才會套用，避免預覽之後 Portal 又變動。沒有超過門檻時不需要這個參數。
- **Rationale**：
  - 在同一個交易內鎖定再寫入，登入的寫入會等待，不需要再比對原值，也就不需要任何檔案。
  - 500 約為歷史單日離職高峰 174 的三倍，大約是在職人數的 10%，足以擋下 Portal 資料出錯造成的大量停用，也容許 worker 停機幾天後累積的正常離職。
- **Alternatives considered**：
  - 門檻用百分比：在職人數會變動，固定人數比較容易驗證。
  - 門檻開成環境變數：沒有實際需要調整的情境。
  - 不設門檻：Portal 狀態欄位大量出錯時，全公司都會被停用。

## 7. 每日排程

- **Decision**：
  - 新增 queue `portal-user-sync`，只在 worker 註冊。檔案放在 `src/worker/users/`：module、scheduler、processor，由 `WorkerModule` import。
  - scheduler 在 `onModuleInit` 呼叫：

    ```ts
    upsertJobScheduler('portal-user-sync:daily', { pattern: '0 4 * * *', tz: TAIPEI_TIME_ZONE_ID }, { name: PORTAL_USER_SYNC_JOB, data: {} })
    ```
  - processor 的 concurrency 為 1。job 選項照既有寫法：`attempts: 1`，`removeOnComplete` 與 `removeOnFail` 都是 1000。
- **Rationale**：
  - 這沿用 `EsignMaintenanceScheduler` 的 `upsertJobScheduler` 寫法。
  - 每個 worker 都會 upsert 同一個 scheduler id，Redis 中只會有一份，BullMQ 每次只把 job 交給一個 worker，所以多個 worker 也不會重複執行（SC-006）。
  - worker 停機錯過 04:00 時，BullMQ 5.81.5 的 `upsertJobScheduler` 會刪除 scheduler 待執行的 job 並排下一次 04:00，單純 upsert 會丟掉錯過的那次。所以 scheduler 先讀已儲存的 `next`：已到期就跳過 upsert，讓 worker 先執行一次補跑；其餘情況照常 upsert，套用目前設定。spec 的 edge case 已經同步這個行為。
  - 這會是 codebase 中第一個 cron pattern。時區使用 `common/date-time.helper.ts` 的 `TAIPEI_TIME_ZONE_ID`。
- **Alternatives considered**：
  - `@nestjs/schedule`：要新增 dependency，而且多個 worker 會重複執行。
  - 沿用 esign 每 30 秒的 maintenance tick 自己判斷時間：會把無關的責任混進 esign。

## 8. 手動匯入 CLI

- **Decision**：
  - `src/maintenance/portal-users.ts` 改為 `NestFactory.createApplicationContext(PortalUserSyncCliModule)`。這個 module 只 import `InfrastructureModule` 與匯入模組，不含 scheduler。
  - 指令：
    - `sync --dry-run`：不寫入；在 stdout 輸出摘要 JSON、被略過的員編與原因，以及要停用的人數。
    - `sync [--allow-deactivations <N>]`：正式執行。
  - 不讀檔也不寫檔。
  - UAT 的執行方式：先載入 `releases/current.env`，再以 `docker compose --env-file /dev/null -f docker-compose.uat.yml run --rm worker` 執行，完整步驟見 runbook [手動執行](../../server/docs/portal-user-import.md#手動執行)。
    這會沿用 `x-backend` 的 env_file 與 `intranet-uat_default` 網路，這個網路已實測可以連到 Portal。
- **Rationale**：
  - 與每日匯入共用同一個服務，規則一定相同。
  - 被略過員編的清單只輸出到操作者的終端機，不寫 log，符合 SC-010 與憲章 III。

## 9. 移除饗賓人的這三條路徑

- **Decision**：只移除這三個端點相關的程式碼，其他沒有呼叫者的饗賓人端點不動（spec 範圍外）。
- 移除：
  - `FeastogetherHrService` 的 `getStaffEmails`、`lookupStaff`、`lookupEligibleStaff`。
  - `FeastogetherDepartmentService.getOrgChart`。
  - `types/staff-emails.parser.ts`（含 spec）、`staff-emails-source.spec.ts`。
  - `FeastogetherClient` 中這三條路徑的 `omitBody`、envelope 檢查與 `staff_lookup` 特例，以及 log 文字「人事來源回應格式錯誤」。
- 搬移：
  - `types/staff-lookup.dto.ts` 搬到 auth。
  - `types/org-chart.dto.ts` 搬到 esign。
- 測試：
  - 刪除約 8 個 e2e 檔中 `getStaffEmails` 的 stub。
  - `test/performance/esign-export-benchmark.ts` 中對 `lookupEligibleStaff` 的覆寫，改為覆寫新的服務。
- 保留：
  - `FeastogetherClient`、`FeastogetherConfig`、`FeastogetherAuthService`（給 `staff/login` 用）。
  - `FeastogetherModule`，改為只由 AuthModule 使用。
  - 錯誤碼 `ESIGN_EMPLOYEE_EMAIL_SOURCE_UNAVAILABLE`，仍由本機信箱服務使用。

## 10. 測試資料庫

- **Decision**：
  - 新增 `test/synthetic-portal.helper.ts`。它在測試用的 MySQL 建立 `${DB_MYSQL_DB}_portal_<uuid>`，符合 `feastogether_intranet_test` 前綴保護，並以 `DB_MYSQL_*` 的連線資訊把 `PORTAL_MYSQL_*` 指向這個資料庫，所以 `.env.test.example` 不需新增變數。
  - 用與 Portal 相同的欄位型別與 collation 建立 `sys_person`、`chi_department`。
  - 另外建立帶有哨兵值的 `person_pass`、`person_id_no`、`birthdate` 欄位，用來驗證這些值不會出現在輸出、log 或本機資料中（SC-008）。
  - 逾時情境使用一個只接受連線、不回應的 `net.Server`。
  - 新增的 e2e 檔要加進 `test/jest-e2e.json` 的 testRegex 允許清單。
- **Rationale**：既有的 `portal-user-recovery.e2e-spec.ts` 已有在測試中自行建表的寫法。只用合成資料，不連真實 Portal（FR-014）。
