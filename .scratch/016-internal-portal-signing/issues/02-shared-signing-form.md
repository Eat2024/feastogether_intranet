# 02：共用簽署表單，保持外部簽署行為

**What to build:** 將既有閱讀、聲明、簽名與提交的共用畫面整理為內外部可用的表單，讓後續本人簽署直接沿用；本票外部使用者操作與結果保持原樣。

**Blocked by:** 無，可開始。

**Status:** claimed

**Tasks coverage:** T020；T001/T002 的電子簽工作區與規範檢查；T023 的外部表單回歸部分。

- [x] 共用表單只負責呈現、簽名狀態及資料轉換，由外部容器負責原 API 與失效處理，不新增 provider framework。
- [x] 外部閱讀、同意、簽署／拒簽、固定 requestId 重試、防連點與切換文件行為不變。
- [x] 電子簽內部流程可使用共用表單而不依賴外部 cookie API 或 Email 文案。
- [x] 前端 lint/build、桌面與窄螢幕外部流程回歸通過；尚無 client 自動測試框架，不虛報自動測試。

## 實作紀錄（2026-10-28）

- 共用 `SigningForm`、`signingTaskForm` 與 `SignSteps` 已抽出；外部容器保留 API、簽署人 ID 與失效處理。內部可注入自己的提交 callback，不需要外部 cookie API。
- 簽署重試沿用 requestId、拒簽相同原因沿用 requestId；以同步 ref 防止同一輪事件連點，切換 signerPublicId 重新掛載表單。
- 驗證：`pnpm -C client lint`、`pnpm -C client build` 通過（含 TypeScript）。沒有新增 client 測試框架；本票為既有行為的共用抽取，未宣稱執行不存在的自動測試。
- 桌面／窄螢幕、鍵盤、實際簽署／拒簽的瀏覽器驗收待整合時以合成資料執行；因此保留該驗收項目未勾選，狀態保持 claimed。

### 瀏覽器回歸補驗

使用本機 Chrome headless CDP、正式建置與合成 API/PDF（`/tmp/ft016-browser.mjs`，未新增專案 dependency）：

- 桌面 1280×900：鍵盤 Space 勾選聲明、PDF 載入、滑鼠手寫簽名、確認送出，模擬 503 後重試成功，兩次 payload 的 requestId 相同，外部 signerPublicId 與 PNG 正確。
- 同一事件連點確認兩次只送一次；加上明確失敗後的重試總共兩次請求。
- 窄螢幕 390×844：切換另一簽署人後重新同意且簽名進度 0/1；無水平溢出；拒簽模擬 503 後重試，requestId 保持一致，呈現拒簽結果。
- 瀏覽器沒有 Runtime exception；截圖 `/tmp/ft016-desktop.png`、`/tmp/ft016-narrow.png`。這是前端 fixture 回歸，不代表正式 Portal／後端整合已驗收。
- 實作 commit：`36536ca`；commit hooks 的 root lint 通過（206 個既有 server warnings），server 104 suites／948 tests 通過。等待 merger 整合後改為 resolved。
