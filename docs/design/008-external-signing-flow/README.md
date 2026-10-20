# Spec 008 外部簽署流程設計稿

對應規格：[`specs/008-external-signing-flow/spec.md`](../../../specs/008-external-signing-flow/spec.md)

- 可編輯原稿：Claude Design 畫布 https://claude.ai/artifact/DgqPtzj9CE2QFAiu3Udsst （僅擁有者與受分享者可開啟）
- 本資料夾為畫布匯出的靜態 HTML，用瀏覽器直接開啟即可檢視；畫面修改請在畫布調整後重新匯出，不直接編輯這些檔案。
- 手機畫面固定為 390×844；字型由 Google Fonts 載入，離線時改用系統字型。

## 畫面

| 檔案 | 畫面 | 對應規格 |
|------|------|----------|
| `01-invite-desktop.html` | 邀請確認頁・桌面 | US1-1、FR-001 |
| `02-invite-mobile.html` | 邀請確認頁・手機 | US1-1、FR-001 |
| `03-invite-invalid-mobile.html` | 邀請連結無效或已到期・手機（桌面同版型） | US3-4、US3-5、FR-002、FR-019 |
| `04-not-started-mobile.html` | 簽署尚未開始・手機（桌面同版型） | US1-7、FR-003 |
| `05-consent-desktop.html` | 步驟 1 同意聲明・桌面 | US1-2、FR-004、FR-005 |
| `06-sign-desktop.html` | 步驟 2～4 閱讀與簽名・桌面（待簽名狀態） | US1-3～6、FR-006～FR-009 |
| `07-sign-mobile.html` | 閱讀與簽名・手機（已簽名、可送出狀態） | US1-4～6、FR-021 |
| `08-done-desktop-ready.html` | 簽署完成・可下載 | US2-2、FR-013、FR-014 |
| `09-done-desktop-generating.html` | 簽署完成・副本產生中 | US2-1、FR-013 |
| `10-done-desktop-failed.html` | 簽署完成・產製失敗 | US2-3、FR-013 |

## 設計決策

- 視覺沿用既有內部系統（`client/src/theme/tokens.ts`、`theme.ts` 與既有元件）：
  - 頁首是深色列加白色粗體「電子簽署」，外部簽署人沒有側邊選單。
  - 頁面標題用 `pageTitle`／`description`，步驟條用 MUI Stepper，卡片為外框 Paper。
  - 邀請確認、失效與尚未開始三個畫面用 `ConfirmDialog` 版型。
  - 「點此簽名」為橘色虛線欄位；按鈕用 MUI large，圖示用 MUI Rounded。
- 簽署步驟與內部流程相同：同意授權條款 → 閱讀文件 → 完成簽名 → 確認送出。同意聲明顯示後端目前有效的 `esign-consent-v1` 全文。
- 外部簽署頁不提供「拒絕簽署」（規格 FR-008）。
- 手機版把簽名進度、同意勾選與「確認簽署」固定在畫面底部，其餘依既有版面由上往下排列。
- 簽署完成頁以「下載已簽署文件」取代驗證網址；下載的 PDF 本身附有簽章驗證 QR Code。
- 畫面中的姓名、Email、文件名稱與日期皆為範例資料。

## 已知設計系統問題（沿用既有樣式，未在此修正）

- 灰色說明文字 `#757575` 放在淺灰背景 `#F3F5F6` 上，對比約 4.2:1，略低於 WCAG AA 4.5:1。
- soft chip 的橘字配淺橘底（「待簽名」）與綠字配淺綠底（「已簽名」）文字對比不足。
