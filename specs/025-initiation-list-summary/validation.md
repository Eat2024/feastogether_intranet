# Spec 025 驗證紀錄

## Ticket 01 — 受理摘要與建立時間

- 整合基線：origin/dev `09c08d0`（含 PR #49／#50），需求提交 `9d08079`；工作分支 impl/025-01。
- 測試邊界沿用已核准 tasks：文件列表 service、真實 HTTP 受理／列表、真實瀏覽器列表與發起畫面。未新增 client 測試框架。
- TDD：新增摘要與 null 結果的 3 個測試先失敗（3 failed／13 passed），實作後 16／16 通過。
- `pnpm -C server test --runInBand esign-document-query.service.spec.ts`：16／16 通過。
- 真實 HTTP／MySQL `esign-initiation-acceptance`：14／14 通過。新增 1／100 人受理後立即摘要、舊草稿期間保留與摘要獨立、兩次重讀、未通過受理不得產生摘要。
- server build、client build 通過。server lint 0 errors／272 既有 warnings；client lint 通過。
- 測試連線僅使用本機 MySQL 的 `feastogether_intranet_test025`，合成 Portal 由既有 helper 建立。原 `.env.test` 帳密不可用，私下讀取本機 DB 連線參數並強制 test DB 名；未輸出秘密。獨立 Redis localhost:16325／DB1，fake mail、local 測試檔案；無真實郵件。
- worktree 初始 symlink node_modules 被 Turbopack 拒絕（超出 root），已改為離線 frozen-lockfile 安裝既有依賴，build 隨後通過；未變更依賴或 lockfile。

### 瀏覽器證據

使用現有 Playwright 快取套件與 Chrome，對真實 Nest 測試 app（13025）及 Next（13026）操作，非攔截 API fixture。

- 合成 1 人及 100 人草稿已保存 email 名單與簽名欄位；實際點擊「發起簽署」，返回列表看到「發起中」、本次期間及 0/1、0/100。
- worker 未啟動時，摘要仍可讀取；重新整理 100 人資料保持正確。
- 瀏覽器時區設 America/Los_Angeles，文件建立時間原值 `2026-11-04T01:13:00Z` 在草稿、發起中、成功後皆顯示 `2026/11/04 09:13`，證明建立時間固定台北顯示。既有簽署日期選擇器維持原有瀏覽器本地日期規則，未擴張修改。
- 1440px 桌面及 390px 窄螢幕檢查表格與「建立時間」欄；沿用表格橫向捲動。
- 由測試 harness 呼叫既有工作執行服務處理 1 人工作，列表自動變為「簽署中」，建立時間不變。這是同 process 實際工作服務驗證，不宣稱獨立 worker process 或效能矩陣已完成。
- 瀏覽器 page errors：0。
- 暫存證據：`/tmp/spec025-browser-harness.cjs`、`/tmp/spec025-browser-check.cjs`、`/tmp/025-initiating-1.png`、`/tmp/025-initiating-100.png`、`/tmp/025-mobile.png`。cookie 僅保存在權限0600的私有暫存檔，不提交。

## 後續驗收

Ticket02／03／04 的角色矩陣、跨連線競態、完整 5213 人效能60樣本及最終整合驗收尚未執行，由各票追加紀錄。不得將本票 1／100 人 smoke test 視為 SC-001 效能驗收完成。
