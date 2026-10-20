# 01: 共用簽署元件與副本讀取的前置重構

**What to build:** 讓外部簽署流程可以直接重用既有的簽署元件與個人副本讀取，但不改變任何現有行為。內部簽署人在「我的電子簽」看到的畫面、建立人與內部簽署人的副本下載，都和重構前完全相同。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 內部簽署畫面的簽名進度面板（簽名進度、「我已閱讀並同意上述文件內容」、確認簽署、拒絕簽署）抽成共用元件；可由參數決定是否顯示拒絕簽署、手機寬度是否固定在畫面底部。內部畫面改用它後外觀與操作不變。
- [x] 同意條款步驟可由呼叫端傳入聲明內容與版本，並可隱藏「不同意，返回」；內部流程仍顯示原本的條款與按鈕。
- [x] 文件檢視元件可由呼叫端指定 PDF 來源；未指定時沿用原本的來源。
- [x] 後端讀取並驗證個人副本的邏輯改為可共用（呼叫端負責授權），建立人與內部簽署人的下載結果不變。
- [x] 後端外部存取中重複的「以邀請憑證查詢簽署人與文件」抽成單一方法，外部 API 的行為與錯誤不變。
- [x] 既有 server 單元、e2e 與 security 測試全數通過；client lint、build 通過。內部簽署頁人工比對（需啟動 dev server）移至 09。

## 交付界線

只做重構，不新增端點、畫面或授權規則。

## 實作紀錄（2026-10-20）

- 分支 `008/01-shared-signing-prefactor`，commit `8d174a2`（重構）、`d3031ea`（合併整合分支）；合併至整合分支 `fe85409`。
- 前端：新增 `SignProgressPanel`（`onReject` 有傳才顯示拒絕簽署、`fixedOnMobile` 手機固定底部）；`TermsStep` 改由呼叫端傳 `terms`、`version`，無 `backHref` 不顯示返回；`DocumentViewer` 新增可選 `pdfUrl`；`signLayout` 新增 `signFieldLabel`。
- 後端：`personalCopy(document, signer)` 公開（呼叫端授權）；`ExternalAccessService.readAccess(token)` 共用憑證查詢，授權規則未改。
- 驗證：server test 89 suites／715 tests、lint:check 0 error、build；e2e 11 suites／72 tests、security 6 suites／25 tests（`_t01` 測試庫）；client lint、build。整合後 server lint／test、client lint／build 再次通過。
- 交接注意事項見 ticket 02 開工說明（TermsStep 標題文字、手機底部留白）。

