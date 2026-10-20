# 08: staging／production 改用公司 Gmail SMTP 寄信

**What to build:** staging 與 production 發起含外部簽署人的文件後，邀請信改由公司 email（Gmail SMTP）寄出，不再使用 SES。部署時只要提供既有的 SMTP 參數，邀請信就能以加密連線、帳號驗證送出；設定缺漏或不安全時，服務在啟動時就明確失敗。

**Blocked by:** 07: 開發環境以公司 Gmail SMTP 寄出邀請信

**Status:** resolved

- [x] development、staging、production 都使用 SMTP 寄信，automated test 維持 fake；環境與寄信方式不符時，server 與 worker 啟動即失敗（沿用既有規則）。
- [x] staging／production 必須設定寄信帳號與密碼，且必須加密連線（直接 TLS，或使用 STARTTLS 時強制升級，不允許明文送出帳密）；缺任何一項時啟動失敗並以繁體中文說明缺少的設定。development 仍可不驗證、不加密，以支援本機 Mailpit。
- [x] 移除不再使用的 SES 寄信實作、SES 寄件人設定與 SES 套件依賴，並更新 root lockfile；production 的檔案儲存（S3）與其區域設定不受影響。
- [x] 不新增環境變數；帳密沿用既有 SMTP 參數，由部署環境提供，不進入版本控制。
- [x] 後端環境變數範例檔、平台文件的寄信說明，以及 Spec 003 外部邀請契約中「UAT／production 使用 SES」的記載同步更新（舊規格加「由 Spec 008 取代」註記並保留原文）。
- [x] 寄送失敗沿用既有重試與失敗紀錄，只留穩定錯誤碼，不記錄 SMTP 回應內容、收件內容、token 或密碼。
- [x] 單元測試涵蓋各環境的寄信設定檢查（staging／production 缺帳密、未加密皆失敗；development 允許 Mailpit 設定）與 SMTP 連線是否強制加密；server lint、測試、build 通過。

## 交付界線

部署前必須先在 staging／production 的部署環境設定寄信 driver 為 SMTP 與全部 SMTP 參數（含應用程式密碼），並移除 SES 寄件人設定，否則 worker 會因設定檢查失敗而無法啟動。Google Workspace 每日寄信上限於上線前確認；寄件人維持 `einvoice@eatogether.com.tw`。

## 實作紀錄（2026-10-20）

- 分支 `008/08-smtp-all-environments`，commit `4269d92`（實作）、`0909e41`（合併整合分支）；合併至整合分支 `69d60a0`。
- 環境檢查：development／staging／production 皆為 smtp、test 為 fake；staging／production 缺 `SMTP_USER`／`SMTP_PASSWORD` 啟動失敗並指出缺項；`AWS_REGION` 改為僅 production 使用 S3 時必填；新增 `isDeployedEnvironment()`。
- SMTP sender 在 staging／production 設定 `requireTLS`，`SMTP_SECURE=false` 時強制 STARTTLS；development 仍允許 Mailpit。
- 移除 SES sender、mail module 的 SES 分支、`SES_FROM` 驗證與 `@aws-sdk/client-sesv2`（lockfile 僅減少 SES 相關 19 行）。
- 文件：`server/.env.example`、`server/docs/internal-electronic-signature-platform.md` §8.1、Spec 003 `contracts/external-invitation.md` §7～§8 取代註記。
- 驗證：server lint:check 0 error、test 89 suites／722 tests、build、security e2e 25/25；整合後 frozen-lockfile、lint、test、build 通過。e2e 在合併前 72/72；合併後 scale 測試因與另一 worktree 同時執行而逾時（71/72），於 09 單獨重跑。
- 部署前人工事項與實際 Gmail 連線驗證列入 09。
- 後續可整理：`auth-cookie.ts`、`auth-mode.ts`、`external-signature-cookie.ts` 各自判斷 staging／production，可改用 `isDeployedEnvironment()`（本票未改，交由 code review 判斷）。

