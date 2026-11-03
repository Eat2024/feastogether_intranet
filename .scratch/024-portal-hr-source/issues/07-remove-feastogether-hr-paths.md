# 07: 移除饗賓人三條人資路徑

**What to build:** intranet 不再保留任何呼叫饗賓人 `hr/org_chart`、`hr/staff_lookup`、`hr/staff_emails` 的程式，也不留 fallback 或開關。`staff/login` 與 WebView token 驗證照舊。

**Status:** claimed

**Blocked by:** [02-org-chart-from-portal](02-org-chart-from-portal.md)、[03-login-staff-from-portal](03-login-staff-from-portal.md)

**Size:** S

**Source:** [Spec](../../../specs/024-portal-hr-source/spec.md)、[Plan](../../../specs/024-portal-hr-source/plan.md)、[Tasks](../../../specs/024-portal-hr-source/tasks.md)、[Contracts](../../../specs/024-portal-hr-source/contracts/portal-source.md)。

**Scope:** T029–T032；FR-010、FR-011；SC-001。

## Acceptance Criteria

- [x] 饗賓人 HR 服務的員工查詢與信箱方法、部門服務的組織樹方法、信箱解析器及其測試都已刪除。
- [x] 饗賓人 client 中這三條路徑的特例（omitBody、envelope 檢查、`staff_lookup` 特例、「人事來源回應格式錯誤」log）都已移除；`staff/login` 的測試仍通過。
- [x] `server/src` 搜尋不到這三條路徑；測試中只剩「呼叫數為 0」的斷言；饗賓人模組只被 auth 使用。
- [x] client 可見的錯誤碼與訊息不變。
- [ ] 相關的 lint、單元測試、build 與 e2e 通過，並附上實際結果與未驗證的限制；整合到 `feat/024-portal-hr-source` 並追加 commit 紀錄後，才可以改成 resolved。

## Comments & Implementation Results

2026-11-03：只建立 ticket，尚未實作。ready-for-agent 不代表可以忽略 Blocked by；前置 ticket 都 resolved 後才能開始。實作結果追加在這裡。

2026-11-03（implementer，branch `feat/024-t07`，commit `8beab9c`）：T029–T032 完成。

- T029：`FeastogetherHrService` 刪除 `getStaffEmails`、`lookupStaff`、`lookupEligibleStaff`、`staffLookupError`、`staffRejectedError`，連同 class-validator／class-transformer 與 `#app/features/auth/dto/staff-lookup.dto` 的 import；spec 刪掉這三個方法的測試。刪除 `types/staff-emails.parser.ts`（含 spec）與 `services/staff-emails-source.spec.ts`。
- T030：`FeastogetherDepartmentService.getOrgChart` 與 spec 中的組織樹測試刪除，連同 `#app/features/esign/dto/org-chart.dto` 的 import。ticket 02、03 留下的兩個 infrastructure → feature 暫時 import 都已消失。
- T031：`FeastogetherClient`：
  - `omitBody` 只剩 `staff/login`，改成單一比較。
  - 刪除 `org_chart`／`staff_emails` 的 envelope 檢查與「人事來源回應格式錯誤」log。
  - 刪除 `staff_lookup` 不記 `upstreamCode` 的特例；`success=false` 一律記 `upstreamCode`（`staff/login` 原本就記，行為不變）。
  - client spec 刪掉五個只測這三條路徑的案例。原本只有 `hr/org_chart` 案例驗證 X-API-KEY、timeout 與不帶 Bearer，所以改用 `staff/login` POST 驗證同一件事；其他 `staff/login` 案例保留。
- T032：
  - `rg "hr/(org_chart|staff_lookup|staff_emails)" server/src` 沒有結果。原本會命中 `org-chart.builder.ts` 的註解，已改寫為「原饗賓人組織樹的來源」。
  - `server/test` 只剩四個登入 e2e 的註解，說明「呼叫數為 0」的斷言。
  - `FeastogetherModule` 只被 `auth.module.ts` import（另有 `security-oauth-login` e2e 自組 module）。`FeastogetherConfig` 的 export 是當初為了 esign 組織樹快取 key 加的，現在沒有 consumer，已移除（FR-010 的設定依賴）。
  - 錯誤碼與訊息都沒有修改。`STAFF_LOOKUP_FAILED` 只由 `EligibleStaffService` 使用；`ORG_CHART_UPSTREAM_UNAVAILABLE` 只由 `EsignSignerCandidateService` 使用；`ESIGN_EMPLOYEE_EMAIL_SOURCE_UNAVAILABLE` 仍由本機信箱服務使用。
- 刻意保留（範圍外，仍有註冊的方法在用）：
  - `feastogether-error.util.ts`（`mapFeastogetherUpstreamError`），以及它使用的 `FEASTOGETHER_UNAUTHORIZED`／`FEASTOGETHER_UNAVAILABLE`。仍被 brand、department 清單、exam ticket／shift／check-in／team members 使用。
  - `hr.types.ts`、`department.types.ts`、`brand.types.ts`、`withQuery`、`FeastogetherConfig`／`FeastogetherClient`／`FeastogetherAuthService`。
- 驗證：
  - `pnpm -C server test`：114 suites／1173 tests 全過。比 base 少 1 個 suite、28 個 tests，都是刪掉的 spec 與案例；commit hook 也通過。
  - `pnpm -C server lint:check`：0 errors，269 warnings，與 base 相同。改過的檔案單獨跑 `eslint` 也是 0 problems；`feastogether-department.service.ts` 原有的 `{ }` 依 prettier 修成 `{}`。
  - `pnpm -C server build`：通過。
  - `pnpm -C server test:e2e:security`：14 suites／84 tests。
  - `pnpm -C server test:e2e -- "(password-login|webview-session|oauth-login|org-chart|mail-whitelist-runtime)"`：5 suites／58 tests。
  - `pnpm -C server test:e2e -- "(esign-candidate-resolution|mail-whitelist-otp|api-coverage)"`：3 suites／59 tests。
- 未驗證／限制：
  - 沒有跑完整 `test:e2e`，留給 ticket 08。
  - 沒有連真實饗賓人或 Portal。
  - WebView token 驗證不經過饗賓人 client，這次沒有改到；只靠 `webview-session` 與 `security-webview-session` e2e 確認行為。
- 範圍外發現（未修改，請 orchestrator 決定）：根目錄 `README.md:65` 仍寫帳密登入「沿用 `/api/v1/hr/staff_lookup` 的資格檢查」，與現況不符（ticket 03 起已改查 Portal）。沒有任何 ticket 涵蓋 README；T032 的 `rg` 只查 `server/src`。
