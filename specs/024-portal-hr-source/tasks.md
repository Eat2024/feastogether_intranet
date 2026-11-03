---

description: "Spec 024 實作任務：Portal 直連取代饗賓人人資查詢"
---

# Tasks: Portal 直連取代饗賓人人資查詢

**Input**：`specs/024-portal-hr-source/` 的 [spec](spec.md)、[plan](plan.md)、[research](research.md)、[data-model](data-model.md)、[contracts](contracts/portal-source.md)、[quickstart](quickstart.md)。

**Tests**：spec FR-014 與憲章 V 明確要求自動化測試，因為本次變更涉及身分驗證與資料完整性。每個 story 先寫測試，確認是因為缺少功能而失敗（不是環境錯誤），再實作。只用合成資料與 `feastogether_intranet_test` 前綴的測試資料庫。

**路徑**：本文件的路徑都相對於 repo 根目錄；server 指令用 `pnpm -C server <script>`。

## Format: `[ID] [P?] [Story] Description`

- **[P]**：可平行處理（不同檔案，且不依賴未完成的任務）。
- **[Story]**：對應 spec 的 user story（US1、US2、US3）。

---

## Phase 1: Setup

**Purpose**：環境變數範例與合成 Portal 測試資料庫，所有 story 都會用到。

- [x] T001 [P] 在 `server/.env.example` 新增 `PORTAL_MYSQL_HOST`、`PORTAL_MYSQL_PORT`（預設 3306）、`PORTAL_MYSQL_USER`、`PORTAL_MYSQL_PASS`、`PORTAL_MYSQL_DB`，值留空或用佔位文字。在註解中寫明只需要 `sys_person` 與 `chi_department` 的 SELECT 權限，不寫任何實際主機、帳號或密碼。
- [x] T002 新增 `server/test/synthetic-portal.helper.ts`，內容如下：
  - 用 `DB_MYSQL_*` 的連線資訊建立臨時資料庫 `${DB_MYSQL_DB}_portal_<uuid>`。建立前檢查名稱以 `feastogether_intranet_test` 開頭，不符合就拒絕。
  - 依 [research §0](research.md) 的欄位型別與 collation 建立 `sys_person` 與 `chi_department`。`sys_person` 另加 `person_pass`、`person_id_no`、`birthdate` 欄位，用來填哨兵值。
  - 提供插入合成人員與部門的函式；人員的哨兵欄位一律填固定的哨兵字串。
  - 把 `process.env.PORTAL_MYSQL_*` 指向這個臨時資料庫，並提供刪除資料庫的清理函式。
  - 提供一個只接受連線、永不回應的 `net.Server`，用來測試逾時。

---

## Phase 2: Foundational（Portal 唯讀連線）

**Purpose**：三個 story 共用的 Portal 連線，放在 `server/src/infrastructure/portal/`，與 `database/` 同層。

**⚠️ CRITICAL**：這個 phase 完成前，不能開始任何 user story。

- [x] T003 [P] 新增 `server/src/infrastructure/portal/portal-directory.service.spec.ts`，驗證以下行為：
  - 送出的 SQL 字串與 [contracts](contracts/portal-source.md) 的查詢逐字相同。
  - 所有 SQL 都不含 INSERT、UPDATE、DELETE，也不含 `person_pass`、`person_id_no`、`birthdate`。
  - pool 參數：`charset: 'utf8mb4'`、`connectionLimit: 3`、`connectTimeout: 10_000`；每個查詢都帶 `timeout: 10_000`。
  - 建構服務時不連線，設定缺漏也不拋錯；直到第一次查詢才拒絕，錯誤訊息不含任何設定值。
  - `findStatusesByEmpids`：每批最多 500 個員編；傳入空陣列時不送出查詢。
  - 模組銷毀時呼叫 `pool.end()`。
- [x] T004 [P] 新增 `server/src/infrastructure/portal/portal.config.ts` 與 `server/src/infrastructure/portal/portal.types.ts`：
  - config 照 `server/src/infrastructure/http-client/feastogether/feastogether.config.ts` 的寫法，用 `ConfigService` 讀 `PORTAL_MYSQL_*`，第一次使用時才檢查必填值。缺漏時拋一般 `Error`，不新增 AppError，也不加入 `validateAppEnvironment`。
  - types 定義四個查詢的資料列型別：部門列、組織樹員工列、登入員工列、在職員工列、狀態列。
- [x] T005 新增 `server/src/infrastructure/portal/portal-directory.service.ts` 與 `server/src/infrastructure/portal/portal.module.ts`：
  - 在第一次查詢時才用 `mysql2/promise` 的 `createPool` 建立連線池。
  - 照 contracts 實作 `listOrgChartSource()`、`findEmployeesByEmpid(empid)`、`listActiveEmployees()`、`findStatusesByEmpids(empids)`。
  - 查詢錯誤原樣拋出，不寫 log；這個服務不做業務判斷。
  - module 匯出 `PortalConfig` 與 `PortalDirectoryService`，不加入 `InfrastructureModule`。
  - 依賴 T003、T004。
- [x] T006 新增 `server/test/portal-directory.e2e-spec.ts`，並加入 `server/test/jest-e2e.json` 的 testRegex 允許清單。使用 T002 的 helper 驗證：
  - 四個查詢對合成資料庫的實際回傳。
  - 4-byte 中文、罕用字與前導零員編完整讀回。
  - 哨兵值不出現在任何查詢結果中。
  - 指向不回應的 server 時，15 秒內拒絕。
  - `PORTAL_MYSQL_*` 缺漏時，HTTP app 仍能正常啟動，查詢時才拒絕。

**Checkpoint**：`pnpm -C server test` 與上述 e2e 都通過，Portal 連線可以開始被各 story 使用。

---

## Phase 3: User Story 1 - 選人部門樹改由 Portal 提供 (Priority: P1) 🎯 MVP

**Goal**：`GET /api/esign/signer-candidates/org-chart` 改由 Portal 組樹，回應、授權、快取與錯誤契約都不變。

**Independent Test**：用合成 Portal 資料、在饗賓人 `hr/org_chart` 被阻斷的情況下，以有效 session 查詢部門樹；比對結構、排序、欄位與快取行為，並確認對饗賓人的請求數為 0。

### Tests for User Story 1

- [x] T007 [P] [US1] 搬移組織樹 DTO，內容不變：
  - 把 `server/src/infrastructure/http-client/feastogether/types/org-chart.dto.ts` 與 `org-chart.dto.spec.ts` 搬到 `server/src/features/esign/dto/`。
  - 更新 `server/src/features/esign/dto/employee-directory-response.dto.ts`、`server/src/features/esign/controllers/signer-candidates.controller.ts`、`server/src/features/esign/services/esign-signer-candidate.service.ts` 與 `server/src/infrastructure/http-client/feastogether/services/feastogether-department.service.ts` 的 import。
- [x] T008 [P] [US1] 新增 `server/src/features/esign/services/org-chart.builder.spec.ts`，移植 fgapi `app/Services/OrgChartBuilder.php` 與 `tests/Feature/OrgChartTest.php` 的規則（fgapi 位於本機 `/Users/user/Documents/fgapi`，只作參考）。涵蓋：
  - 多根節點與深層巢狀；沒有員工的部門保留空的 `children` 與 `employees`。
  - 子部門的員工不會複製到上層。
  - 上層代碼為空字串時視為 null；上層部門不存在或已停用時，該部門成為根節點。
  - 對不到部門的員工不列入，並回傳未對應人數。
  - 部門與員工維持輸入順序（排序在 SQL 完成）。
  - 部門代碼空白或重複、形成循環、深度超過 100 層時拋錯。
  - 空的輸入回傳空陣列。

### Implementation for User Story 1

- [x] T009 [US1] 新增 `server/src/features/esign/services/org-chart.builder.ts`：純函式，輸入 Portal 部門列與員工列，輸出 `{ tree: OrgDepartmentDto[], unmappedEmployees: number }`；規則見 [research §4](research.md)。依賴 T007、T008。
- [x] T010 [US1] 更新 `server/src/features/esign/services/esign-signer-candidate.service.spec.ts`，驗證：
  - 快取未命中時改用 `PortalDirectoryService.listOrgChartSource()` 加上 builder，並寫入 1,800 秒快取。
  - 快取 key 維持 `esign:org-chart:v2:` 前綴，命名空間為 `sha256(JSON.stringify([NODE_ENV, 'portal', host, port, db]))`。
  - Portal 錯誤或組樹失敗：拋 `ORG_CHART_UPSTREAM_UNAVAILABLE`，不寫快取。
  - Redis 錯誤：仍是 `ORG_CHART_UNAVAILABLE`。
  - log 只記未對應人數，不記員編或姓名。
- [x] T011 [US1] 修改 `server/src/features/esign/services/esign-signer-candidate.service.ts` 與 `server/src/features/esign/esign.module.ts`：
  - 改注入 `PortalDirectoryService` 與 `PortalConfig`，不再依賴 `FeastogetherDepartmentService` 與 `FeastogetherConfig`。
  - `EsignModule` 改 import `PortalModule`，移除 `FeastogetherModule`。
  - 讀快取時仍用 `parseOrgChart` 驗證。
  - 依賴 T009、T010。
- [x] T012 [US1] 改寫 `server/test/org-chart.e2e-spec.ts`，改用 T002 的合成 Portal，覆蓋 spec US1 情境 1–6，並另外驗證：
  - 饗賓人 client 一被呼叫就讓測試失敗。
  - 刪除合成 `chi_department` 表（模擬權限被收回）時回傳 502、不寫快取，帳密以外的登入仍可用。
  - Portal 不回應時，15 秒內回傳 502。
  - 回應中不出現哨兵值。
- [x] T013 [US1] 更新 `server/test/mail-whitelist-runtime.e2e-spec.ts`：移除對 `/api/v1/hr/org_chart` 的合成回應，改成只要呼叫任何 `hr/*` 路徑就讓測試失敗；寄信白名單仍只讀本機資料。

**Checkpoint**：部門樹完全由 Portal 提供；`pnpm -C server test` 與 `org-chart`、`mail-whitelist-runtime` 的 e2e 通過。

---

## Phase 4: User Story 2 - 三個登入入口的員工資料改讀 Portal (Priority: P1)

**Goal**：帳密登入、WebView、OAuth 三個入口改由 Portal 查員工資料；資格規則、本機寫入欄位與錯誤碼都不變。

**Independent Test**：用合成 Portal 人員資料、在饗賓人 `hr/staff_lookup` 被阻斷的情況下，對三個入口分別測試試用、正式、其他狀態、查無、多筆、欄位不合法與 Portal 無法連線，並比對本機員工資料。

### Tests for User Story 2

- [ ] T014 [P] [US2] 搬移員工查詢 DTO，驗證規則不變：把 `server/src/infrastructure/http-client/feastogether/types/staff-lookup.dto.ts` 與 `staff-lookup.dto.spec.ts` 搬到 `server/src/features/auth/dto/`，並更新所有 import。
- [ ] T015 [P] [US2] 新增 `server/src/features/auth/services/eligible-staff.service.spec.ts`，驗證 `lookupEligibleStaff(empId)`：
  - 用 `findEmployeesByEmpid` 查詢，再以 `===` 精確比對員編；大小寫不同或尾端有空白的資料不算相符。
  - 狀態 0 對應「試用」、1 對應「正式」，回傳現行的 `StaffLookupDto` 形狀。
  - 以下情況都拋 `AUTH_EXCHANGE_FAILED`：精確相符 0 筆或多筆、狀態不是 0／1、欄位不符合 DTO 規則（姓名空白、員編或部門代碼含非法字元、長度超過限制）。
  - Portal 查詢失敗時拋 `STAFF_LOOKUP_FAILED`。

### Implementation for User Story 2

- [ ] T016 [US2] 新增 `server/src/features/auth/services/eligible-staff.service.ts`，照 [research §5](research.md) 實作，並在 `server/src/features/auth/auth.module.ts` 註冊、import `PortalModule`。`FeastogetherModule` 保留，帳密登入仍要用 `FeastogetherAuthService`。依賴 T014、T015。
- [ ] T017 [US2] 修改 `server/src/features/auth/services/auth.service.ts` 與 `server/src/features/auth/services/oauth-identity.service.ts`，以及兩者的 `.spec.ts`：
  - 把 `FeastogetherHrService` 換成 `EligibleStaffService`。
  - 帳密登入仍先經 `FeastogetherAuthService.authenticate` 驗證密碼，驗證順序與錯誤對應不變。
  - 寫入本機欄位的方式不變，見 [data-model](data-model.md)「登入時的員工資料」。
  - 依賴 T016。
- [ ] T018 [US2] 改寫 `server/test/password-login.e2e-spec.ts`、`server/test/oauth-login.e2e-spec.ts`、`server/test/webview-session.e2e-spec.ts` 與 `server/test/security-webview-session.e2e-spec.ts`，員工資料改由 T002 的合成 Portal 提供（帳密驗證仍用既有的 `FeastogetherClient` 替身）。覆蓋：
  - spec US2 情境 1–6。
  - 員編只差大小寫或尾端空白。
  - Portal 不回應時，15 秒內回傳 `STAFF_LOOKUP_FAILED`，不改查饗賓人，也不用本機舊資料放行。
  - 饗賓人 `hr/staff_lookup` 的呼叫數為 0。
- [ ] T019 [P] [US2] 機械式更新其他 e2e 的登入替身：
  - 涉及的檔案：
    - `server/test/core-esign-flow.e2e-spec.ts`、`core-esign-flow-queue.e2e-spec.ts`、`core-esign-flow-scale.e2e-spec.ts`
    - `esign-document-delivery-security.e2e-spec.ts`、`esign-draft-settings.e2e-spec.ts`、`esign-export.e2e-spec.ts`、`esign-rejection.e2e-spec.ts`、`esign-reminders.e2e-spec.ts`、`esign-signer-management.e2e-spec.ts`
    - `s3-export.e2e-spec.ts`、`server/test/performance/esign-export-benchmark.ts`
  - 把 `overrideProvider(FeastogetherHrService)` 改成 `overrideProvider(EligibleStaffService)`，只保留 `lookupEligibleStaff`。
  - 移除 `getStaffEmails` 替身，並刪除 `server/test/synthetic-staff-emails.helper.ts` 中不再使用的 `syntheticStaffEmails`；`seedSyntheticStaffEmails` 保留。
  - 依賴 T017。

**Checkpoint**：三個登入入口都改由 Portal 查詢；auth 相關的單元測試與 e2e，以及 T019 涉及的 e2e 全數通過。

---

## Phase 5: User Story 3 - 每天自動從 Portal 更新本機員工主檔 (Priority: P2)

**Goal**：worker 每天 04:00（台北時間）從 Portal 匯入本機 `users`：
- 不合法資料列個別略過。
- 停用 Portal 明確非在職的人，但有門檻。
- 不留任何檔案。

手動 CLI 與 worker 共用同一個服務。

**Independent Test**：用 5,001 位合成人員觸發匯入兩次，核對分類、中文完整性，以及第二次 0 變更。再分別注入不合法資料列、超過門檻的停用人數與 Portal 故障，確認行為符合 spec，且工作目錄沒有新增檔案。

### Tests for User Story 3

- [ ] T020 [P] [US3] 新增 `server/src/features/users/portal-user-sync.rules.spec.ts`：
  - 從 `server/src/maintenance/portal-users.spec.ts` 移植欄位正規化測試，去掉 HEX 與 TSV 解析的部分。
  - 依 [data-model](data-model.md)「匯入分類」新增：
    - 略過原因 `missing_name`、`invalid_email`、`too_long`、`invalid_empid`、`conflict`。
    - 完全相同的重複列合併計算；員編只差大小寫算衝突。
    - `create`、`update`、`noop`、`protected`。
    - `deactivate` 的條件：Portal 有這個員編但沒有 0／1 資料列。
    - 不動的情況：Portal 查無、本機已停用或軟刪除、被略過的員編。
    - 停用門檻：剛好 500 人可套用，501 人被擋。
    - 摘要不含員編、姓名或 Email。

### Implementation for User Story 3

- [ ] T021 [US3] 新增 `server/src/features/users/portal-user-sync.rules.ts`，把 `server/src/maintenance/portal-users-source.ts` 的欄位規則與 `server/src/maintenance/portal-users-import.ts` 的 `planOperations`／`summarize` 搬進來，輸入改成 Portal 查詢的資料列。加入略過分類、停用規劃與門檻常數 `PORTAL_USER_DEACTIVATION_LIMIT = 500`。依賴 T020。
- [ ] T022 [US3] 新增 `server/src/features/users/services/portal-user-sync.service.ts` 與 `server/src/features/users/portal-user-sync.module.ts`，照 [research §6](research.md) 實作 `run({ trigger, dryRun, confirmedDeactivations? })`：
  1. 讀 Portal 在職名單。
  2. 對本機在職、但不在名單中的員編，用 `findStatusesByEmpids` 查狀態。
  3. 在單一交易中，用 `server/src/features/users/repositories/user.repository.ts` 既有的依 id 升冪鎖定方法鎖定，並檢查新員編。
  4. 規劃與寫入都經 `UserRepository`，失敗時整筆 rollback。
  5. 回傳摘要；log 事件照 contracts。

  module import `PortalModule`。依賴 T021。
- [ ] T023 [US3] 整理匯入的 e2e：
  - 新增 `server/test/portal-user-sync.e2e-spec.ts`，使用 T002 的合成 Portal，覆蓋 spec US3 情境 1–9、11、12，以及 SC-005、SC-009、SC-010：
    - 5,001 人兩次匯入。
    - 不合法資料列只略過該員編，log 不含它們的員編。
    - 停用與門檻。
    - Portal 故障時本機變更數為 0。
    - 匯入交易進行中，同時有登入寫入同一員工：登入等待匯入完成，沒有部分寫入。
    - 執行前後工作目錄沒有新增檔案。
    - 哨兵值不出現在本機資料或 log。
  - `server/test/portal-user-import.e2e-spec.ts` 只保留 repository 的查詢與鎖定測試。
  - 刪除 `server/test/portal-user-recovery.e2e-spec.ts`。
  - 在 `server/test/jest-e2e.json` 移除 `portal-user-recovery`，加入 `portal-user-sync`。
  - 依賴 T022。
- [ ] T024 [P] [US3] 新增 worker 排程，照 `server/src/worker/esign/esign-maintenance.scheduler.ts` 的 `upsertJobScheduler` 寫法：
  - 新增 `server/src/worker/users/` 下的四個檔案：
    - `portal-user-sync.constants.ts`
    - `portal-user-sync.scheduler.ts`（含 `.spec.ts`）：scheduler id 為 `portal-user-sync:daily`，排程為 `{ pattern: '0 4 * * *', tz: TAIPEI_TIME_ZONE_ID }`。
    - `portal-user-sync.processor.ts`（含 `.spec.ts`）：concurrency 1；以 `trigger: 'schedule'` 呼叫 `run`；超過門檻或失敗時記錄 contracts 的 log 事件，不重試。
    - `portal-user-sync-worker.module.ts`
  - 在 `server/src/worker.module.ts` import 這個 module。queue 只在 worker 註冊，HTTP app 不註冊。
  - 依賴 T022。
- [ ] T025 [US3] 在 `server/test/portal-user-sync.e2e-spec.ts` 加入排程驗證（SC-006）：
  - 兩個 worker application context 連同一個測試 Redis，各自啟動後，Redis 中只有一個 `portal-user-sync:daily` scheduler，pattern 與 tz 正確。
  - 同一個 job 只被處理一次。
  - 用 BullMQ 的下次執行時間計算，驗證連續 7 天每天恰好在台北時間 04:00 觸發一次。
  - 依賴 T023、T024。
- [ ] T026 [US3] 改寫手動 CLI `server/src/maintenance/portal-users.ts` 與 `server/src/maintenance/portal-users.spec.ts`：
  - 用 `NestFactory.createApplicationContext` 載入 `InfrastructureModule` 與 `PortalUserSyncModule`，不含 scheduler。
  - 只支援兩種指令：`sync --dry-run`、`sync [--allow-deactivations <N>]`。dry-run 在 stdout 輸出摘要、被略過的員編與原因，以及要停用的人數。
  - 結束碼照 contracts；不接受 `--input`、`--output`、`--exclude-file`、`--acquired-at` 與 rollback 指令。
  - 刪除 `server/src/maintenance/portal-users-source.ts`、`portal-users-import.ts`、`portal-users-store.ts`、`portal-users-recovery.ts`。
  - 依賴 T022。
- [ ] T027 [US3] 在 `server/test/portal-user-sync.e2e-spec.ts` 加入 CLI 驗證（spec US3 情境 10）：
  - dry-run 不寫入，stdout 列出被略過的員編，log 中不出現它們。
  - 超過門檻時：不帶參數，或 N 與停用人數不符，都以非零狀態結束且不寫入；N 相符時套用。
  - 依賴 T026。
- [ ] T028 [US3] 改寫 `server/docs/portal-user-import.md`：
  - 移除 HEX 匯出 SQL、搬檔、`--input`、預覽檔與原值檔、rollback，以及「不連線 Portal」「部門樹與登入仍用原來源」等描述。
  - 加入每日 04:00 自動匯入、查看 `portal_users.sync_*` log 的方式、`sync --dry-run` 與 `--allow-deactivations` 的步驟、第一次上線時超過門檻的處理，以及 Portal 故障時的處理。
  - 不寫真實員編、主機或帳密。

**Checkpoint**：每日匯入、手動 CLI 與 runbook 完成；US3 的單元測試與 e2e 通過。

---

## Phase 6: 移除饗賓人三條路徑（FR-010，跨 story）

**Purpose**：US1 與 US2 完成後，這三條路徑已沒有呼叫者，一次刪除相關程式，不保留為 fallback。

- [ ] T029 [P] 修改 `server/src/infrastructure/http-client/feastogether/services/feastogether-hr.service.ts` 與其 `.spec.ts`：
  - 刪除 `getStaffEmails`、`lookupStaff`、`lookupEligibleStaff`、`staffLookupError`、`staffRejectedError`。
  - 刪除 `server/src/infrastructure/http-client/feastogether/types/staff-emails.parser.ts`（含 `.spec.ts`）與 `server/src/infrastructure/http-client/feastogether/services/staff-emails-source.spec.ts`。
  - 依賴 T019。
- [ ] T030 [P] 從 `server/src/infrastructure/http-client/feastogether/services/feastogether-department.service.ts` 與其 `.spec.ts` 刪除 `getOrgChart`。依賴 T011。
- [ ] T031 修改 `server/src/infrastructure/http-client/feastogether/feastogether.client.ts` 與 `feastogether.client.spec.ts`：
  - 從 `omitBody` 清單移除這三條路徑，並移除它們的 envelope 檢查與 `staff_lookup` 特例。
  - 移除 log 文字「人事來源回應格式錯誤」。
  - `staff/login` 與 WebView token 驗證的行為不變。
  - 依賴 T029、T030。
- [ ] T032 確認移除完整：
  - `rg "hr/(org_chart|staff_lookup|staff_emails)" server/src` 沒有結果。
  - `server/test` 中只剩「呼叫數為 0」的斷言。
  - `FeastogetherModule` 只被 `server/src/features/auth/auth.module.ts` import。
  - `server/src/common/errors/app-errors.ts` 的 `STAFF_LOOKUP_FAILED` 改由 `EligibleStaffService` 使用；`ORG_CHART_UPSTREAM_UNAVAILABLE` 改由 Portal 來源使用。錯誤碼與訊息都不變（FR-011）。
  - 依賴 T031。

---

## Phase 7: Polish & 整合驗證

- [ ] T033 執行 `pnpm -C server lint:check`、`pnpm -C server test`、`pnpm -C server build`、`pnpm -C server test:e2e`，再執行 root `pnpm lint` 與 `pnpm build`，確認 client 沒有變更也能建置。在 `specs/024-portal-hr-source/quickstart.md` 追加實際結果與未驗證的限制。依賴 T001–T032。
- [ ] T034 檢查 `specs/006-signer-candidate-org-chart/spec.md` 與 `specs/023-portal-user-email/spec.md` 的 Spec 024 註記。實作若改變了取代範圍，同步更新（FR-012）。依賴 T033。

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup（Phase 1）**：沒有依賴。
- **Foundational（Phase 2）**：依賴 T002；會擋住所有 story。
- **US1（Phase 3）、US2（Phase 4）**：都只依賴 Phase 2，彼此獨立，可以平行。
- **US3（Phase 5）**：只依賴 Phase 2。T023 的「登入同時寫入」測試用的是既有的登入寫入路徑，不需要等 US2。
- **移除（Phase 6）**：T029 依賴 US2（T019），T030 依賴 US1（T011）。
- **Polish（Phase 7）**：依賴全部完成。

### User Story Dependencies

- **US1（P1）**：Phase 2 完成後即可開始，不依賴其他 story。
- **US2（P1）**：Phase 2 完成後即可開始，不依賴其他 story。
- **US3（P2）**：Phase 2 完成後即可開始，不依賴其他 story。

### Within Each User Story

- 先寫測試並確認紅燈，再實作。
- 搬移檔案（T007、T014）先做，避免和新程式衝突。
- 純規則（builder、rules）→ 服務 → module 接線 → e2e。

### 不可同時執行

- `server/test/jest-e2e.json` 會被 T006、T023 修改，需要依序整合。
- 會重設同一個測試資料庫的 e2e 不要同時跑。

### Parallel Opportunities

- Phase 1：T001 與 T002。
- Phase 2：T003 與 T004。
- Phase 2 完成後：US1、US2、US3 可由不同人同時進行。
- US1：T007 與 T008。US2：T014 與 T015。US3：T020 先完成，之後 T024 與 T026 可平行。
- Phase 6：T029 與 T030。

---

## Parallel Example: User Story 1

```bash
Task: "T007 搬移 org-chart.dto.ts 到 server/src/features/esign/dto/"
Task: "T008 新增 server/src/features/esign/services/org-chart.builder.spec.ts"
```

## Parallel Example: User Story 3

```bash
# T022 完成後
Task: "T024 新增 server/src/worker/users/ 排程與 processor"
Task: "T026 改寫 server/src/maintenance/portal-users.ts CLI"
```

---

## Implementation Strategy

### MVP First（User Story 1）

1. 完成 Phase 1 與 Phase 2（Portal 連線）。
2. 完成 US1（部門樹）。
3. 停下來驗證：部門樹與饗賓人規則一致、對 `hr/org_chart` 的呼叫數為 0。

### Incremental Delivery

1. Setup + Foundational：Portal 連線可用。
2. US1：部門樹脫離饗賓人。
3. US2：登入的員工資料脫離饗賓人，帳密驗證仍走 `staff/login`。
4. US3：每日自動匯入取代人工 HEX 匯入。
5. Phase 6：刪除三條饗賓人路徑。
6. Phase 7：整合驗證。

UAT 上線前，維運要在 `server.env` 加入 `PORTAL_MYSQL_*`，部署後先跑 `sync --dry-run`。見 [plan](plan.md)「UAT 上線前置」。

---

## Notes

- 每個 task 只有一個主責；重跑前面的測試屬於回歸驗證，不算重複分派。
- 不新增資料表、migration、dependency、fallback 或開關；環境變數只有 `PORTAL_MYSQL_*`。
- 不提交任何真實員編、名冊、主機、帳號或密碼。
