# 02: 員工 Email 批次查詢與發起前檢查

**What to build:** 草稿建立人可檢查已選員工是否有有效收件信箱，取得逐人可寄送狀態及遮罩地址；來源失敗與無有效信箱可明確區分，檢查本身不保存或寄信。

**Blocked by:** None (can start immediately).

**Status:** resolved

**Spec:** 010 — US1、FR-002～004、FR-015～016。對應 T007、T010、T013、T014、T009 的預覽／批次核對測試，以及 T004 的信箱來源錯誤。T001、T002 的必要環境檢核及合成 HR fixture 在本票獨立完成或沿用已整合成果，不等待 01，也不重建測試框架。

**執行約定:** 依使用者核准的票單依賴執行；本票可用既有本機帳號及合成草稿獨立驗收，不依賴 01 的解析 API 或 03 的 migration。共用錯誤與 helper 修改須協調整合，避免覆寫。僅後端及契約文件，不修改 client、不部署；resolved 須驗收通過並已整合，追加結果與 commit 紀錄。

- [ ] 經既有服務端 API Key 串接 staff_emails，每批最多 100 個完整員編、最多 20 碼 ASCII 英數字串；不傳員工 Bearer、不新增設定或依賴。
- [ ] 嚴格驗證成功 envelope 與回傳型別，依完整員編映射而非陣列位置；空或稀疏結果、空白／非法地址為 unavailable，不推斷人事原因。重複或請求外員編、結構錯誤為 502。
- [ ] 來源 401／403、失敗或逾時轉為來源錯誤，不冒充員工登入失效；request 與 unwrap 兩處敏感 body 均不記錄。
- [ ] 同次核對每批 100 人、最多 4 批併發、每批 10 秒逾時；失敗停止派送新批並收束已派請求，不新增重試、Email cache、fallback 或 queue。
- [ ] 文件信箱檢查僅限草稿建立人，接受 1–6,000 個有效 userId 字串；未授權先拒絕，狀態／輸入／來源錯誤依契約回 404／409／422／502。
- [ ] 成功只回 userId、ready／unavailable、maskedEmail（不可用時 null），使用 private,no-store；不修改帳號、草稿、快照，不發邀請。
- [ ] 覆蓋前導零、亂序、缺漏、非法地址、重複／額外資料、批次邊界、逾時與授權的 unit／HTTP 測試通過；相關錯誤契約與 Swagger 一致。

## 實作與驗證紀錄（2026-10-21）

- 在 `feat/010-ticket-02` 獨立 worktree 依已核准的 parser／來源／service／HTTP seams 進行 red → green；先確認不存在的 parser、來源方法及 HTTP 路徑失敗，再加入實作；另以失敗測試鎖住嚴格 envelope、日誌遮蔽及四批併發收束。
- 實作 commit：`3b79d93`；整合分支 `38aec7b` 已於 `7978635` 合併入本票，保留 Ticket 01 與本票的錯誤碼、測試清單及契約。
- 合併後 server build 通過；全套 unit **104 suites／896 tests 通過**；server lint:check **0 errors／197 warnings**（既有警告，未新增抑制規則）。
- 合併後隔離 MySQL／Redis HTTP **3 suites／38 tests 通過**：員工解析 18、組織快取 8、員工信箱檢查 12。已加入預設 e2e 清單，不依賴額外 testRegex 才能執行。
- 信箱來源單元驗證含完整字串員編、前導零、亂序、稀疏、空白／非法地址、重複／請求外資料、成功 envelope、401／403／連線失敗映射與兩條日誌路徑遮蔽；10 秒 timeout 透過既有 Axios 傳輸設定驗證。
- 服務容量測試涵蓋 1、100、101、6,000 人，逐人結果完整，每批最多 100、同次最多 4 批；來源失敗停止派新批並等待已派請求完成。不新增重試、快取、queue、設定、依賴或 migration。
- HTTP 驗證真實 session／OriginGuard／DB／Controller／Service，只替換外部 HTTP 傳輸；草稿建立人、非建立人、非草稿、無效帳號、格式錯誤、no-store、遮罩及重查不快取均通過。測試使用合成資料，未呼叫真實 HR、未寄信。
- 與後續發起整合的公開服務：`resolveUsers(userIds, manager?)` 回傳 userId／完整 empid；`lookupEmails(identities)` 回傳同序 email 或 null。交易內重新核對與固定收件地址屬 Ticket 03；本票仍為 claimed，待 merger 驗證及合併後結案。

## 整合驗收紀錄（2026-10-21）

- 實作 `3b79d93`、整合同步 `7978635` 及證據 `0a83ca1`，以 `--no-ff` 合入 `feat/010-internal-email-signing`，merge commit：`5b65d50`，無衝突。
- 合併者核對來源 envelope／parser、兩處敏感 body 遮蔽、既有 API Key 與 10 秒 timeout、四批併發停止與收束，以及文件權限先於來源查詢；確認未新增 Email cache、資料表、設定或前端修改。
- 整合分支重新執行 `pnpm --config.verifyDepsBeforeRun=false -C server test:e2e --testRegex '(esign-candidate-resolution|org-chart|esign-employee-email-checks).e2e-spec.ts$'`：3 suites／38 tests 通過，包含 Ticket 01 回歸。測試 DB／Redis 序列使用並於完成後釋放。
- 同一程式碼樹的 unit 104 suites／896 tests、build 及 lint:check（0 errors／197 既有 warnings）證據如上；`git diff --check` 通過。上述七項驗收均完成，改為 resolved，發起時固定地址與交易重驗仍由 Ticket 03 處理。
