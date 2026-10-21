# 01: 內部員工選取與帳號解析

**What to build:** 建立人可從既有組織樹或員編搜尋選取員工，將已選完整員編解析成本機簽署人識別；瀏覽組織或搜尋不會隱性匯入帳號。

**Blocked by:** None (can start immediately).

**Status:** claimed

**Spec:** 010 — US1、FR-001～003、FR-015～016。對應 T008、T011、T012、T018 的組織快取回歸，以及 T004 的解析錯誤；T001、T002 的本票必要基準與合成資料先行完成。

**執行約定:** 使用者已核准八張垂直切分票單；跨票先後以各票 Blocked by 為準，原 tasks 的階段式排序僅供工作項目追溯，不要求先完成無關 schema 或完整簽署流程。所有票單僅實作後端、必要 migration 與契約文件，不修改 client、不部署、不建立遠端 issues。開始實作改 claimed；驗收通過且合併至功能整合分支後才改 resolved，追加驗證與 commit 紀錄，保留原驗收條件。

- [ ] 先核對專案指引、憲章、版本與測試隔離；僅用合成資料及既有 harness，不讀出 secret、不清理開發資料庫。共用測試資源須序列執行或隔離。
- [ ] 已選員編解析接受 1–100 個、每個 1–20 碼 ASCII 英數字串，保留前導零、去重保序；回傳逐人 resolved／unavailable 與契約允許的本機識別資料，不回信箱。
- [ ] 本機帳號優先；缺帳號僅在既有 HR lookup 支援的 5–8 碼範圍精確比對並建立帳號，其他長度回 unavailable；不得以組織快取代替資格檢查。
- [ ] 停用或刪除帳號不自動恢復；並發解析不重複建帳；上游失敗回契約 502，已合法建立的帳號可保留。
- [ ] 既有候選人 GET 僅查本機、不寫入；解析 POST 驗證員工 session 與 Origin，驗證失敗不得呼叫來源。
- [ ] 組織樹沿用共用 Redis 7,200 秒快取，命中不呼叫來源且不續期，過期由下一次查詢更新；不新增排程、強制刷新或全公司匯入。
- [ ] 解析 HTTP、帳號唯一性、授權、GET 唯讀及快取回歸測試通過；同步相關 API 契約並記錄驗證結果。不得宣稱前端選人已完成。

## 實作紀錄（2026-10-21）

- 分支 `feat/010-ticket-01`；起點為整合分支 `feat/010-internal-email-signing`，已同步 `c62fc46`。依 implement-spec 與 tdd 執行，採使用者確認的 HTTP／服務／來源／快取 seams。
- 新增 POST resolutions；GET candidates 改唯讀。本機批讀包含停用／軟刪除帳號，只有缺帳號且 5–8 碼者查既有資格來源；沿用 transaction 與員編唯一約束處理並發。
- 新增解析 DTO、必要回應裁切及 directory-unavailable 錯誤；沿用 OriginGuard／員工 session，不回 Email；OpenAPI 與員工契約同步。
- 紅燈證據：GET 唯讀案例最初取得新建帳號而失敗；POST 解析最初 404；來源失敗錯誤最初仍為 STAFF_LOOKUP_FAILED。各階段修正後轉綠。原 11 個 GET 隱性匯入單元案例改由真實 HTTP＋MySQL 的新規格案例取代，保留組織快取單元測試。
- Node v26.4.0、pnpm 11.9.0；沿用已驗證的測試 DB prefix 與非零 Redis DB，與另一 ticket 序列使用資源。HR HTTP boundary 使用合成來源，未呼叫真實 HR、未寄信，測試只清理本次建立的合成人員。
- 完整 server unit：101 suites／862 tests 通過；server build 通過；lint:check 無 error（既有 warning 保留），本票新改核心檔案定向 lint 零 warning。
- 初次 HTTP 驗證：候選解析 15 cases＋組織快取 8 cases，共 23 通過（含跨 HTTP 實例共用、TTL 不續期、到期才更新）。另補邊界、部分失敗重試及 Swagger 驗證，待最終重跑記錄。
- Client、schema、migration、dependencies、環境變數、排程均無變更；前端選人畫面仍待後續串接。票單維持 claimed，待合併者驗證並合入整合分支後結案。
- 最終 HTTP 重跑：`pnpm --config.verifyDepsBeforeRun=false -C server test:e2e --testRegex '(esign-candidate-resolution|org-chart).e2e-spec.ts$'`，2 suites／26 tests 通過（解析 18＋快取 8）。新增 suite 已納入一般 e2e 設定。
