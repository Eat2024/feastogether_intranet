# Quickstart: 外部簽署流程驗證

本文件說明如何驗證 Spec 008；API 細節見 [contracts/http-api.md](contracts/http-api.md)，欄位語意見 [data-model.md](data-model.md)。

## 前置條件

- 本機 MySQL 8.4、Redis 7 執行中；`server/.env` 已設定 SMTP（寄得出邀請信）、`EXTERNAL_SIGNING_ORIGIN=http://localhost:3000`、`AUTH_TRUSTED_ORIGINS` 含 `http://localhost:3000`。
- `pnpm dev` 啟動 server（:3001）、worker 與 client（:3000）。worker 必須執行，才會寄信與產生個人副本。
- 以建立人身分登入電子簽（入口網 SSO 或 `POST /api/auth/login`）。
- 建立含 Email 簽署人的測試文件：在 `/forms/new` 上傳 PDF、設定簽署並發起（`dev` 已正式串接建立人端），簽署人填自己可收信的信箱。

## 自動化驗證

```bash
pnpm -C server lint:check
pnpm -C server test
pnpm -C server build
pnpm -C server test:e2e            # 需要 .env.test 與 feastogether_intranet_test* 測試庫
pnpm -C server test:e2e:security
pnpm -C client lint
pnpm -C client build
```

預期全部通過；e2e 涵蓋 research.md 第 11 點列出的情境。

## 手動驗收（桌面與手機寬度各一次）

手機寬度用 Chrome DevTools 的裝置模式（390×844）。

1. **邀請確認**：開啟邀請信連結 → 看到「電子簽署邀請」卡片與「開啟電子簽署文件」按鈕（設計稿 `01`／`02`）。
1-1. **驗證碼**：按下按鈕 → 看到驗證碼輸入頁與遮罩後的信箱（`11`），同一信箱收到「電子簽署驗證碼」信，信中沒有連結；輸入錯誤驗證碼顯示剩餘次數（`12`）；60 秒內按重新寄送顯示需等待；輸入正確驗證碼後進入簽署頁。
2. **同意聲明**：按下按鈕 → 進入 `/external-signatures/{signerPublicId}`，步驟 1 顯示聲明全文與版本 `esign-consent-v1`；未勾選前「同意並繼續」不可按（`05`）。
3. **閱讀與簽名**：可切換頁面縮圖、看到「點此簽名」欄位與自動帶入的日期；未完成簽名或未勾選「我已閱讀並同意上述文件內容」時「確認簽署」不可按；手機版操作區固定在底部（`06`／`07`）。畫面上沒有「拒絕簽署」。
4. **送出**：完成簽名、勾選同意、確認送出 → 完成頁顯示「產生中」，數秒內自動轉為「下載已簽署文件」（`09` → `08`）；下載的 PDF 只有本人簽名與日期，附驗證 QR Code。
5. **建立人比對**：建立人在文件詳情下載該簽署人的副本，與步驟 4 下載的檔案內容相同。
6. **重新開啟**：關閉瀏覽器，重新開啟邀請信連結、按「開啟電子簽署文件」並輸入新的驗證碼 → 直接進入完成頁，可再次下載，沒有簽署步驟。
6-1. **簽署人綁定**：同一瀏覽器先後開啟同一份文件兩位簽署人的邀請（各自通過驗證碼），回到第一個分頁送出簽名 → 被拒並提示重新開啟邀請連結，兩位簽署人都未被誤簽。
7. **文件停止後**：建立人停止該文件 → 已簽者重新開啟連結仍可下載。
8. **尚未開始**：發起一份開始日為明天的文件，開啟邀請並按按鈕 → 看到「簽署尚未開始」與開始時間（`04`），瀏覽器沒有新的 `FT_ESIGN_EXTERNAL_ACCESS` cookie。
9. **失效**：竄改連結中的 token、或使用已停止文件的待簽者連結 → 看到「邀請連結無效或已到期」（`03`），訊息不透露原因。
10. **簽署期限過後**：由 e2e 以 fake timers 推進到簽署期限之後，驗證已簽者仍可開啟與下載、待簽者看到失效頁。

## 提交前

以 `git status`、`git diff` 確認只有本規格範圍內的變更；憲章的 Sync Impact Report 由專案負責人確認後移除。
