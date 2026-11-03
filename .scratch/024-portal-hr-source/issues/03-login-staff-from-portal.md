# 03: 三個登入入口的員工資料改讀 Portal

**What to build:** 同仁用帳密、饗賓人 App WebView 或 OAuth 登入時，員工資料改為即時查 Portal，並照現行規則更新本機員工資料。帳密仍先由饗賓人 `staff/login` 驗證；資格規則、錯誤碼與訊息都不變；新進同仁當天就能登入。

**Status:** resolved

**Blocked by:** [01-portal-connection](01-portal-connection.md)

**Size:** L：除了登入本身，還要把約 11 個 esign e2e 的登入替身一起改掉，否則它們會壞。

**Source:** [Spec](../../../specs/024-portal-hr-source/spec.md)、[Plan](../../../specs/024-portal-hr-source/plan.md)、[Tasks](../../../specs/024-portal-hr-source/tasks.md)、[Contracts](../../../specs/024-portal-hr-source/contracts/portal-source.md)。

**Scope:** T014–T019；US2；FR-006、FR-007、FR-011；SC-003、SC-004、SC-007。

## Acceptance Criteria

- [x] 以完整員編精確比對（大小寫不同或尾端有空白的資料不算相符），必須剛好一筆試用或正式資料；0 對應「試用」、1 對應「正式」。
- [x] 查無、多筆、其他狀態或欄位不合法時，回傳 `AUTH_EXCHANGE_FAILED`，不把資料寫入本機；Portal 失敗或逾時，15 秒內回傳 `STAFF_LOOKUP_FAILED`，不改查饗賓人，也不用本機舊資料放行。
- [x] 帳密登入時，密碼通過但 Portal 顯示已非在職，拒絕登入；密碼錯誤與帳號停用的錯誤對應不變。
- [x] 三個入口寫入本機的欄位與現行相同（OAuth 不寫人員狀態與職稱），也不寫本機部門外鍵。
- [x] 三個入口的 e2e 改用合成 Portal，呼叫饗賓人 `hr/staff_lookup` 的次數為 0；其他 esign e2e 改用新的登入替身，且不再替身 `getStaffEmails`。
- [x] 相關的 lint、單元測試、build 與 e2e 通過，並附上實際結果與未驗證的限制；整合到 `feat/024-portal-hr-source` 並追加 commit 紀錄後，才可以改成 resolved。

## Comments & Implementation Results

2026-11-03：只建立 ticket，尚未實作。ready-for-agent 不代表可以忽略 Blocked by；前置 ticket 都 resolved 後才能開始。實作結果追加在這裡。

2026-11-03（implementer，branch `feat/024-t03`，commits `c7c5b73`、`1b9e189`）：T014–T019 完成。

- T014：`StaffLookupDto` 與 spec 搬到 `server/src/features/auth/dto/`，驗證規則不變。`FeastogetherHrService` 暫時改從 `#app/features/auth/dto/staff-lookup.dto` import（infrastructure 依賴 feature），ticket 07 刪掉 `lookupEligibleStaff` 時一併移除。
- T015／T016：新增 `server/src/features/auth/services/eligible-staff.service.ts`（含 spec）。`AuthModule` 註冊它並 import `PortalModule`，`FeastogetherModule` 保留。
  - Portal 查詢失敗：`STAFF_LOOKUP_FAILED`，原始錯誤不記錄也不帶出。
  - 以 `===` 比對員編後，狀態 0／1 的資料必須剛好一筆，否則 `AUTH_EXCHANGE_FAILED`。同員編的其他狀態資料（例如舊的離職紀錄）不影響結果。
  - 轉成 `StaffLookupDto` 後用 class-validator 驗證，不合法時 `AUTH_EXCHANGE_FAILED`。
- T017：`AuthService` 與 `OauthIdentityService` 改注入 `EligibleStaffService`，寫入本機的程式不變。帳密登入仍先呼叫 `FeastogetherAuthService.authenticate`。兩個 spec 只改替身名稱與測試名稱。
- T018：四個 e2e 改用合成 Portal，`FeastogetherClient.get`（`hr/staff_lookup`）的呼叫數斷言為 0。
  - `password-login`：
    - 狀態 0／1 登入成功，寫入姓名、人員狀態、部門代碼／名稱、職稱，不寫 `department_id` 外鍵。
    - 以下情況回 `AUTH_EXCHANGE_FAILED`，且不建立帳號：查無、兩筆在職、密碼通過但已非在職、員編只差大小寫、只差尾端空白、姓名空白、部門代碼非法。
    - 調職，以及部門清空（Portal 空字串 → 本機 NULL）。
    - `RENAME TABLE` 模擬權限被收回：回 502 `STAFF_LOOKUP_FAILED`，回應不含 Portal 主機、帳號、資料庫名稱。
    - Portal 不回應：15 秒內回 `STAFF_LOOKUP_FAILED`，本機已有帳號也不放行，回應不含設定值。afterAll 先關不回應 server，再關 app。
  - `oauth-login`：
    - 今天才寫入 Portal 的新進同仁可立即登入。
    - OAuth 只寫部門，`personStatus`／`titleName` 維持 NULL。
    - 五種拒絕情境、調職、部門清空、Portal 失敗。
  - `webview-session`：既有的白名單欄位、保留本機外鍵、部門同步與失敗測試改用 Portal 資料，並新增五種拒絕情境。
  - `security-webview-session`：改用合成 Portal；偽造簽章時斷言 Portal 未被查詢。
- T019：
  - 10 個 e2e 與 `test/performance/esign-export-benchmark.ts` 改為 `overrideProvider(EligibleStaffService)`，只保留 `lookupEligibleStaff`。
  - 移除 `getStaffEmails` 替身與 `syntheticStaffEmails`。
  - `esign-reminders` 原本 spy `FeastogetherHrService.getStaffEmails` 並斷言沒被呼叫；這個方法已沒有 production 呼叫者，ticket 07 會刪掉它，所以移除這個 spy。同一測試的其他斷言仍確認只用本機資料。
- 範圍外但必要：`server/test/security-oauth-login.e2e-spec.ts` 自己組 testing module，未提供 `EligibleStaffService` 會發生 DI 失敗，所以改為提供並替身它。
- 與 research §5／data-model 不同的決定（請 orchestrator 確認）：
  1. 驗證前，先把 Portal 的 `person_name`、`department_id`、`department_name`、`title` trim，空字串轉成 null。
     - Portal 這四欄都是 `NOT NULL DEFAULT ''`。`department_id = ''` 會被 DTO 的 `Matches` 拒絕，沒有部門的員工就無法登入。
     - 原來源 fgapi 的 `SyncUsersFromPortal::normalizeString` 對這四欄就是這樣處理。照做之後，寫入本機的結果才與現行相同，例如職稱空白時保留舊職稱、部門名稱寫 NULL。
     - 員編不 trim：spec 明定尾端空白不算相符（fgapi 會 trim，這是 spec 刻意的差異）。
  2. 舊實作以 LIKE 查詢，任一筆結果驗證失敗就整批拒絕。新查詢是精確相等，只驗證被選中的那一筆。
- 驗證：
  - `pnpm -C server test -- src/features/auth/services/eligible-staff`：17/17。
  - `pnpm -C server test`：115 suites／1201 tests 全過（兩次 pre-commit hook 亦通過）。
  - `pnpm -C server lint:check`：0 errors；269 個 warnings 與基準相同，新檔沒有 warning。
  - `pnpm -C server build`：通過。
  - `pnpm -C server test:e2e -- password-login`：15/15。
  - `pnpm -C server test:e2e -- oauth-login`：9/9。
  - `pnpm -C server test:e2e -- webview-session`：11/11。
  - `pnpm -C server test:e2e -- "core-esign-flow|esign-document-delivery-security|esign-draft-settings|esign-export|esign-rejection|esign-reminders|esign-signer-management"`：10 suites／170 tests。
  - `pnpm -C server test:e2e:security`：14/14 suites、84/84（含 security-webview-session、security-oauth-login）。
  - `pnpm -C server test:e2e` 全套：39/40 suites、427/428 tests。唯一失敗的 internal-email-capacity 是 5,001 人測試在 180 秒內未完成，原因是平行 worktree 共用同一台 MySQL 的負載；這個測試不經過登入。單獨重跑 `pnpm -C server test:e2e -- internal-email-capacity`：7/7。
  - 這條路徑關閉 ticket 01 的未勾項：帳密登入 e2e 在 Portal 權限被收回與不回應時，回應都不含 Portal 主機、帳號、資料庫名稱。
- 未驗證／限制：
  - `s3-export.e2e-spec.ts`（本機沒有 `moto_server`）與 performance benchmark 沒有執行。已用 `tsc -p test/tsconfig.json` 確認這兩檔沒有型別錯誤。
  - Portal 不回應的 15 秒情境只在帳密登入 e2e 驗證。WebView 與 OAuth 共用同一個 `EligibleStaffService`，只用立即失敗（`RENAME TABLE`）驗證錯誤對應。
  - 合成 Portal 的欄位長度比 DTO 上限短（姓名 50、部門代碼 11、部門名稱 40、職稱 20），「長度超過限制」只有單元測試覆蓋。
  - 沒有連真實 Portal。

整合 commit：`ba0de0f`（feat/024-portal-hr-source）。
