# 08: staging／production 改用公司 Gmail SMTP 寄信

**What to build:** staging 與 production 發起含外部簽署人的文件後，邀請信改由公司 email（Gmail SMTP）寄出，不再使用 SES。部署時只要提供既有的 SMTP 參數，邀請信就能以加密連線、帳號驗證送出；設定缺漏或不安全時，服務在啟動時就明確失敗。

**Blocked by:** 07: 開發環境以公司 Gmail SMTP 寄出邀請信

**Status:** ready-for-agent

- [ ] development、staging、production 都使用 SMTP 寄信，automated test 維持 fake；環境與寄信方式不符時，server 與 worker 啟動即失敗（沿用既有規則）。
- [ ] staging／production 必須設定寄信帳號與密碼，且必須加密連線（直接 TLS，或使用 STARTTLS 時強制升級，不允許明文送出帳密）；缺任何一項時啟動失敗並以繁體中文說明缺少的設定。development 仍可不驗證、不加密，以支援本機 Mailpit。
- [ ] 移除不再使用的 SES 寄信實作、SES 寄件人設定與 SES 套件依賴，並更新 root lockfile；production 的檔案儲存（S3）與其區域設定不受影響。
- [ ] 不新增環境變數；帳密沿用既有 SMTP 參數，由部署環境提供，不進入版本控制。
- [ ] 後端環境變數範例檔、平台文件的寄信說明，以及 Spec 003 外部邀請契約中「UAT／production 使用 SES」的記載同步更新（舊規格加「由 Spec 008 取代」註記並保留原文）。
- [ ] 寄送失敗沿用既有重試與失敗紀錄，只留穩定錯誤碼，不記錄 SMTP 回應內容、收件內容、token 或密碼。
- [ ] 單元測試涵蓋各環境的寄信設定檢查（staging／production 缺帳密、未加密皆失敗；development 允許 Mailpit 設定）與 SMTP 連線是否強制加密；server lint、測試、build 通過。

## 交付界線

部署前必須先在 staging／production 的部署環境設定寄信 driver 為 SMTP 與全部 SMTP 參數（含應用程式密碼），並移除 SES 寄件人設定，否則 worker 會因設定檢查失敗而無法啟動。Google Workspace 每日寄信上限於上線前確認；寄件人維持 `einvoice@eatogether.com.tw`。
