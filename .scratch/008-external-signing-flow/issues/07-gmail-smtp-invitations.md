# 07: 開發環境以公司 Gmail SMTP 寄出邀請信

**What to build:** 開發環境發起含外部簽署人的文件後，邀請信透過公司 Gmail SMTP 寄到簽署人的信箱，信中連結可開啟邀請確認頁。其他人照著後端環境變數範例檔設定，就能在自己的本機寄出邀請信。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 後端環境變數範例檔記錄公司 Gmail SMTP 設定：主機 smtp.gmail.com、連接埠 587、以 STARTTLS 連線（不使用直接 TLS）、寄件帳號與寄件人、密碼留空並註明使用 Google 應用程式密碼；不得包含實際密碼。
- [ ] 本機以公司 Gmail SMTP 實際寄出外部邀請信，收件匣收到，信中連結可開啟邀請確認頁。（需人工，移至 09）
- [x] 以錯誤密碼驗證（以 mock SMTP transport 模擬 EAUTH 535；實際連 Gmail 的人工驗證移至 09）：寄送失敗依既有重試規則處理，寄送紀錄只留失敗狀態與穩定錯誤碼，不記錄 SMTP 回應內容、收件內容、token 或密碼。
- [x] 後端 lint 通過。

## 交付界線

本票只處理開發環境的設定說明與實寄驗證；staging／production 改用 SMTP 屬 08。

## 實作紀錄（2026-10-20）

- 分支 `008/07-gmail-smtp-invitations`，commit `777a8f8`；合併至整合分支 `517dd8d`。
- `server/.env.example` 改為公司 Gmail SMTP（smtp.gmail.com:587、STARTTLS、einvoice@eatogether.com.tw、密碼留空），保留改回 Mailpit 的說明；`ESIGN_MAIL_DRIVER` 規則與 `SES_FROM` 留給 08。
- `external-invitation.processor.spec.ts` 新增 2 個測試：真實 SMTP sender＋mock transport 模擬帳密錯誤，驗證只留 `failed`／`MAIL_DELIVERY_FAILED`、依退避重試、紀錄與輸出不含 SMTP 回應、收件人、token 或密碼；以暫時改壞 processor 確認測試能抓到問題。
- 驗證：server lint:check 0 error、test 89 suites／712 tests、build 通過；整合後 lint 與 test 再次通過。e2e 未跑（未改執行中程式碼，e2e 使用 fake 寄信）。
- 實際以 Gmail 寄信與錯誤密碼連線兩項需人工，已列入 09。

