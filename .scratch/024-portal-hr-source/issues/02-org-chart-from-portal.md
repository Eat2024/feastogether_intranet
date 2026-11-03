# 02: 選人部門樹改由 Portal 提供

**What to build:** 建立人開啟選人時，部門樹改由 Portal 的部門與人員資料組成，組樹規則照饗賓人現行行為。回應格式、授權、30 分鐘快取與錯誤碼都不變，饗賓人 `hr/org_chart` 故障不再影響選人。

**Status:** claimed

**Blocked by:** [01-portal-connection](01-portal-connection.md)

**Size:** L

**Source:** [Spec](../../../specs/024-portal-hr-source/spec.md)、[Plan](../../../specs/024-portal-hr-source/plan.md)、[Tasks](../../../specs/024-portal-hr-source/tasks.md)、[Contracts](../../../specs/024-portal-hr-source/contracts/portal-source.md)。

**Scope:** T007–T013；US1；FR-004、FR-005、FR-011；SC-002、SC-007。

## Acceptance Criteria

- [x] 組樹規則與 fgapi 一致：只包含未停用部門與正式員工；上層不存在或已停用時成為根節點；子部門員工不複製到上層；對不到部門的員工不列入，只記人數。
- [x] 部門代碼空白或重複、形成循環、深度超過 100 層時，回傳 502 `ORG_CHART_UPSTREAM_UNAVAILABLE`，不寫快取；合法的空資料回傳空陣列並快取。
- [x] 快取 1,800 秒、讀取不續期；未登入一律 401；快取命名空間改為 Portal 來源，舊的饗賓人快取自然不再命中。
- [x] 部門表無法讀取或 Portal 不回應時，15 秒內回傳 502；登入不受影響。
- [x] 測試期間呼叫饗賓人 `hr/org_chart` 的次數為 0；寄信白名單的 e2e 對任何 `hr/*` 呼叫都會失敗。
- [x] `EsignModule` 不再依賴饗賓人模組；回應中不出現哨兵欄位的值。
- [ ] 相關的 lint、單元測試、build 與 e2e 通過，並附上實際結果與未驗證的限制；整合到 `feat/024-portal-hr-source` 並追加 commit 紀錄後，才可以改成 resolved。

## Comments & Implementation Results

2026-11-03：只建立 ticket，尚未實作。ready-for-agent 不代表可以忽略 Blocked by；前置 ticket 都 resolved 後才能開始。實作結果追加在這裡。

2026-11-03（implementer，branch `feat/024-t02`，commits `c19b6e5`、`991944b`、`4d803ec`）：T007–T013 完成。

- T007：`org-chart.dto.ts`（含 spec）原樣搬到 `server/src/features/esign/dto/`，更新四處 import。`FeastogetherDepartmentService` 暫時改由 `#app/features/esign/dto/org-chart.dto` import，ticket 07 刪 `getOrgChart` 時一併移除。
- T008／T009：`server/src/features/esign/services/org-chart.builder.ts`（純函式 `buildOrgChart`，回傳 `{ tree, unmappedEmployees }`）與 spec（11 個案例）。
- T010／T011：`EsignSignerCandidateService` 改注入 `PortalDirectoryService`、`PortalConfig`、`AppLoggerService`；`EsignModule` 改 import `PortalModule`，不再 import `FeastogetherModule`。
  - 快取 key：`esign:org-chart:v2:` + `sha256(JSON.stringify([NODE_ENV ?? 'development', 'portal', host, port, db]))`；port 是數字（`PortalConfig.port`）。
  - 設定缺漏、Portal 錯誤、組樹失敗都轉成 `ORG_CHART_UPSTREAM_UNAVAILABLE`，不保留原始錯誤、不寫 log、不寫快取；Redis 錯誤仍是 `ORG_CHART_UNAVAILABLE`。
  - 有未對應員工時記 `esign.org_chart_unmapped_employees`，metadata 只有 `{ unmappedEmployees }`。
- T012：`server/test/org-chart.e2e-spec.ts` 改用合成 Portal（15 個測試），覆蓋 US1 情境 1–6、空資料快取、三種不合法樹、50 個並發未命中、Swagger、Redis 503。另外驗證：
  - `FeastogetherClient` 的 get／post 一被呼叫就拋錯，`afterEach` 確認呼叫數為 0。
  - 部門表無法讀取時 502、不寫快取，回應不含 Portal host／user／db 與 `chi_department`；之後改回可恢復。
  - Portal 不回應時約 10 秒回 502（< 15 秒），回應不含連線設定。
  - `PortalConfig` 缺 `PORTAL_MYSQL_DB` 時 app 照常啟動，查詢回 502，回應不含設定值或變數名稱。這補上 ticket 01 尚未勾選的條件（部門樹這條路徑）。
  - 回應不含 `PORTAL_SENTINEL`；log 只有人數，不含員編或姓名。
- T013：`mail-whitelist-runtime.e2e-spec.ts` 移除 `hr/org_chart` 與 `hr/staff_emails` 的合成回應；饗賓人 client 的任何呼叫都直接拋錯，結尾照舊確認呼叫數為 0。

與 tasks／research 不同或需要注意的決定：
1. 「部門代碼空白」以 `trim()` 判斷，不只空字串。fgapi 只擋 `''`，但現行 intranet 會再用 `parseOrgChart`（`/\S/`）驗證 fgapi 的輸出，只有空白的代碼本來就會整批 502，所以端到端行為不變。
2. Portal 設定缺漏時，計算快取 key 就會失敗，所以在讀快取前就回 502（不讀快取）。
3. 「刪除 chi_department」改成 `RENAME TABLE`，測完改回，才能在同一個測試驗證恢復；對 app 來說兩者都是「表不存在」。
4. 「帳密以外的登入仍可用」：目前登入還沒改讀 Portal（ticket 03），所以 e2e 改成驗證部門表無法讀取時，`PortalDirectoryService.findEmployeesByEmpid` 仍能讀人員表。ticket 03 整合後，若要改成實際打 WebView／OAuth 登入，就在這個測試裡改。
5. 合法空資料的 e2e 用同結構的空表（`CREATE TABLE ... LIKE`）暫時替換，測完換回，不 mock Portal 服務。

驗證：
- `pnpm -C server test -- src/features/esign`：42 suites／585 tests 全過。
- `pnpm -C server test`：115 suites／1201 tests 全過（三個 commit 的 pre-commit hook 也都通過）。
- `pnpm -C server lint:check`：0 errors、269 warnings，與 base 相同；新增與修改的檔案沒有 warning。
- `pnpm -C server build`：通過。
- `pnpm -C server test:e2e -- org-chart`：15/15。log 中沒有 `chi_department`、`_portal_`、`synthetic_reader`、`ETIMEDOUT`、`http.unhandled_exception`。
- `pnpm -C server test:e2e -- "(org-chart|mail-whitelist-runtime|api-coverage|portal-directory|esign-candidate-resolution)"`：5 suites／79 tests 全過。
- `pnpm -C server test:e2e:security`：14 suites／84 tests 全過。

未驗證／限制：
- 沒有連真實 Portal；與饗賓人結果的一致性只以合成資料、依 fgapi 規則手算的預期樹比對，沒有對真實 `hr/org_chart` 回應逐筆比對。
- 15 秒上限只驗證了「不回應」的情況（第一個查詢 10 秒就拒絕）。若 Portal 慢但有回應，兩個查詢依序各有 10 秒期限，最多約 20 秒（ticket 01 已記錄）。
- 沒有跑完整 `test:e2e`。

