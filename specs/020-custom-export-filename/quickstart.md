# Quickstart: 自訂當次匯出檔名驗收

本文件供後續實作驗收使用，目前尚未實作。不要將下列指令列出視為已執行或測試通過。

## 前置條件

- 已安裝 workspace 依賴；本機 MySQL／Redis 與既有開發登入可用。
- 準備兩位同部門員工、一位跨部門員工、一份已發起文件，以及該文件已完成的 ZIP；全部使用合成測試資料。
- e2e 使用既有 `.env.test`，DB 名稱必須以 `feastogether_intranet_test` 開頭。
- API 經由與頁面同源的 `/api` proxy；另保留入口網實際嵌入環境供驗收。

## 指令

在 repository root 執行：

```bash
pnpm dev
```

實作後執行範圍驗證：

```bash
pnpm -C server test --runInBand export-file-name
pnpm -C server test:e2e --testPathPatterns=esign-export
pnpm -C server lint:check
pnpm -C server build
pnpm -C client lint
pnpm -C client build
pnpm lint
pnpm build
```

測試檔命名應讓第一個命令覆蓋本功能 helper 與 HTTP 測試；client 沒有 test script，不新增測試框架。

## 驗收情境

1. **Excel**：輸入中文名稱下載，確認 `.xlsx`、內容與篩選條件；輸入空白時與既有預設一致。非法名稱時不產生成功紀錄，修正後可原頁重試。
2. **ZIP**：已有 ZIP 時輸入名稱下載，確認名稱與解壓內容；工作 ID、檔案 hash、歷史筆數不變；空白回到原名稱。
3. **副檔名與長度**：`.xlsx` 切 ZIP、`.zip` 切 Excel、大小寫、100 字輸入邊界、255 bytes 最終邊界、路徑與控制字元均按 spec 處理。
4. **權限與錯誤**：無 session、跨部門、草稿、已刪除文件、其他工作的 fileId、ZIP 未完成均拒絕；不能因先取得準備結果繞過 GET 的授權。
5. **並行**：兩個員工 session 同時以不同名稱下載同一 ZIP，各自正確，不改共用 metadata。GET 分別驗證無旗標及 `downloadName=client` 的 200／206／416、If-Range。
6. **隱私**：DevTools 確認名稱只在 POST body／回應，下載 URL 只有固定旗標；伺服器 log 不含輸入名稱或 response 檔名。
7. **真瀏覽器門檻**：Chrome／Edge 的實際入口網頁面，以及 Safari／Firefox 同源頁，確認建議檔名、下載起始、錯誤後原頁仍在、大檔未由前端完整載入。也驗證原生下載中斷與續傳；不得把發出下載連結當成完成。

若第 7 項於實際支援環境失敗，記錄瀏覽器／入口網條件並回到 plan，不默默加 Blob fallback、放寬 iframe 安全標頭或把名稱放進 URL。

## 交付紀錄

記錄各測試實際結果及未執行原因；區分單元／HTTP／DB 整合／瀏覽器證據。此次 plan 不更動應用程式、migration 或設定。


## Ticket 01 實作驗證（2026-11-03）

- TDD：名稱 helper 首次因模組尚未存在失敗；最小中文案例通過後，補空白／副檔名／非法字元／長度案例確認 33 failed，再實作完整規則至通過。新增準備下載 HTTP 首次回 404，實作後 200；目前兩個 suites 共 51 tests 通過。
- HTTP 測試採真 ExportsController、EsignExportService、EsignAccessPolicyService、AuthGuard、OriginGuard 與 ValidationPipe；僅資料庫／queue／session 查詢邊界替換。service 規則由此整合 seam 一併覆蓋，未另造重複 service 測試檔。
- 已通過 server build、server lint:check（既有 268 warnings、0 errors）、client lint。
- Worktree 透過既有 node_modules symlink 使用已安裝套件；pnpm 以 `pnpm_config_verify_deps_before_run=false` 避免重裝。client 預設 Turbopack build 因 node_modules 指向 worktree filesystem root 之外而失敗，須由整合工作目錄重跑，不能記為建置通過。
- T001 由主代理執行臨時合成內容 probe：Chrome 156.0.8078.74，同源 attachment 不附 filename，延遲觸發 a.download「年度副本.zip」＋獨立 target/noopener；建議名稱正確、download.failure=null、原頁保留。此結果僅為最小機制確認，不替代入口網／完整 UI 驗收。
- Excel 真前端合成資料驗收與整合分支建置由主代理於合併後執行；本階段尚未驗證實際 UI 或完成 ticket 結案。

### Ticket 01 整合驗收

2026-11-03，commit `b0ea2a0` 已整合；root `pnpm build` 通過。Chrome 156 的實際前端以合成攔截 API 驗證 Excel 自訂／預設／副檔名切換／錯誤不新增紀錄／修正重試，並讀取真實下載 XLSX 的儲存格，全部通過。此為前端驗收，後端授權證據為獨立真 HTTP/service/policy 測試，不混稱完整 DB 端到端驗收。

### Ticket 02 實作分支驗證（2026-11-03，尚待整合與瀏覽器驗收）

- ZIP POST 案例先確認 400 失敗；新增處理後 200。下載模式案例先確認仍含原 filename 而失敗，再實作固定旗標至通過。
- helper／真 HTTP-controller-service-policy 共 69 tests 通過；server build、root lint、client `next typegen` + `tsc --noEmit` 通過。
- `test:e2e --testPathPatterns=esign-export`：2 suites／96 tests 通過，包含新 ZIP 準備與既有歷史匯出驗證；確認兩位同部門員工同時準備不同名稱，job/file metadata、queue 與歷史無新增或改寫，跨部門與錯誤成果關聯拒絕。
- `.env.test` 原本的本機 MySQL 認證失敗；確認本機 root 空密碼可唯讀連線後，僅以程序環境 `DB_MYSQL_PASS=''` 執行上述測試，維持既有測試 DB 前綴保護，沒有修改 `.env` 或組態。
- 檢查 access log 既有電子簽 body 排除仍有效；新 GET 只有固定旗標、不含名稱，API 回應不含 storage key。成果不可用的既有狀態為 503，契約與 Swagger 已更正描述，未變更既有錯誤行為。
- 此 worktree 的 client build 仍由整合目錄驗證；T012／T014／T017／T018 未勾選。Safari/Edge 與實際入口網驗收不可用既有單元或 HTTP 結果代替。
