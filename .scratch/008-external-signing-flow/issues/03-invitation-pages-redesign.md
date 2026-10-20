# 03: 邀請確認頁與失效頁依設計稿改版

**What to build:** 外部簽署人點開邀請信連結時，看到依設計稿呈現的「電子簽署邀請」確認卡片（說明、「開啟電子簽署文件」按鈕、勿轉寄與期限提醒）；連結無效、過期或格式錯誤時，看到「邀請連結無效或已到期」說明卡片，桌面與手機都正常顯示。這兩頁在取得存取前由後端直接產生。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 邀請確認頁依設計稿的確認型卡片版型呈現：深色「電子簽署」頁首、圖示、標題、說明、主要按鈕與兩行提醒；手機寬度可正常閱讀與點擊。
- [x] 單純開啟邀請連結仍不查詢資料、不記錄開啟、不設 cookie；按下按鈕才建立存取。
- [x] 失效頁標題為「邀請連結無效或已到期」，提示聯絡文件發起人並列出可能原因；無效、過期、已停止、格式錯誤都顯示相同內容，不揭露是哪一種原因，也不回顯 token。
- [x] 服務暫時無法使用時顯示對應說明頁。
- [x] 既有安全標頭（CSP、不快取、不送 referrer、禁止被嵌入）不變；頁面不載入任何外部資源，只用系統字型；所有動態內容都經過跳脫處理。
- [x] 單元測試涵蓋三種頁面內容與跳脫；e2e 驗證確認頁 200、失效頁 400／401 與標頭；既有外部簽署流程測試照常通過。

## 實作紀錄（2026-10-20）

- 分支 `008/03-invitation-pages-redesign`，commit `9372c86`（實作）、`41bdbee`（合併整合分支）；合併至整合分支 `f6b87b8`。
- 新增 `external-invitation-page.ts`：邀請確認頁、失效頁、服務暫停頁共用版型，動態值統一跳脫；樣式為頁內 `<style>`（支援手機 media query，符合 CSP `style-src 'unsafe-inline'`）。
- controller：確認頁改版並移除無作用的 `nonce`；400／401 回同一份失效頁、5xx 回服務暫停頁；CSP、`no-store`、`no-referrer` 不變。
- `escapeHtml` 抽到 `server/src/common/escape-html.ts`，邀請信共用；刪除無人使用的 `ESIGN_INVITATION_FORMAT_INVALID`、`ESIGN_INVITATION_EXPIRED`、`ESIGN_INVITATION_SERVICE_UNAVAILABLE`。
- 驗證：server lint:check 0 error、test 90 suites／722 tests、build、e2e 72/72（scale 單獨重跑通過）、security 25/25；整合後 lint、test（729）、build 通過。
- 服務暫停頁無設計稿（文案與圖示為自訂）、手機實機目視與 `html-error-page.ts` 是否刪除，列入 12。

