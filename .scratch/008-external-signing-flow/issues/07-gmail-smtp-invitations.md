# 07: 開發環境以公司 Gmail SMTP 寄出邀請信

**What to build:** 開發環境發起含外部簽署人的文件後，邀請信透過公司 Gmail SMTP 寄到簽署人的信箱，信中連結可開啟邀請確認頁。其他人照著後端環境變數範例檔設定，就能在自己的本機寄出邀請信。

**Blocked by:** None (can start immediately)

**Status:** claimed

- [ ] 後端環境變數範例檔記錄公司 Gmail SMTP 設定：主機 smtp.gmail.com、連接埠 587、以 STARTTLS 連線（不使用直接 TLS）、寄件帳號與寄件人、密碼留空並註明使用 Google 應用程式密碼；不得包含實際密碼。
- [ ] 本機以公司 Gmail SMTP 實際寄出外部邀請信，收件匣收到，信中連結可開啟邀請確認頁。
- [ ] 以錯誤密碼驗證：寄送失敗依既有重試規則處理，寄送紀錄只留失敗狀態與穩定錯誤碼，不記錄 SMTP 回應內容、收件內容、token 或密碼。
- [ ] 後端 lint 通過。

## 交付界線

本票只處理開發環境的設定說明與實寄驗證；staging／production 改用 SMTP 屬 08。
