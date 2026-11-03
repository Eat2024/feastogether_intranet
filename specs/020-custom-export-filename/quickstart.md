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
