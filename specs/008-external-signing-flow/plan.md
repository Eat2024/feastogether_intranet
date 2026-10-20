# Implementation Plan: 外部簽署流程畫面與本人副本下載

**Branch**: 待定（尚未建立分支） | **Date**: 2026-10-20 | **Spec**: [spec.md](spec.md)

**Input**: `specs/008-external-signing-flow/spec.md`

**Status**: Plan 完成，待審查；尚未產生 tasks、尚未實作。憲章已配合修訂為 1.4.0（Principle III），待專案負責人於 commit 前確認。

## Summary

外部簽署人目前點開邀請後沒有前端簽署頁，簽署後也拿不到本人副本。本計畫一次交付前後端：

- **後端**：外部授權拆成「存取」與「簽署」兩種檢查。已簽者可隨時開啟與下載本人副本，不設期限（簽署寫入維持現狀：保留 digest、清除期限與密文），不新增欄位。簽署成功不再清除 cookie，沿用驗證碼通過時產生的存取憑證（research §15）。待簽者在開始時間前開啟時，回「簽署尚未開始」頁。新增唯讀任務查詢與副本下載兩個 GET 端點。邀請確認、失效、尚未開始三個後端 HTML 頁依設計稿改版。
- **前端**：新增 `/external-signatures/[signerPublicId]`，重用既有簽署元件。流程為同意聲明 → 閱讀與簽名 → 確認送出 → 完成頁；完成頁輪詢副本狀態並提供下載。

另外，開發、staging 與 production 都改用公司 Gmail SMTP 寄邀請信，移除不再使用的 SES 寄信實作與依賴。

2026-10-20 CR：外部簽署人按下開啟後須先通過 6 位數驗證碼（OTP，存 Redis、同步寄信）才建立存取；外部送出簽名綁定頁面所屬簽署人，阻擋 cookie 被覆蓋時簽錯人（research.md §13、§14）。

不新增資料表、欄位、migration、dependency、環境變數或排程。

## Technical Context

**Language/Version**: TypeScript 5.7；Node >=20.19。

**Primary Dependencies**: server 沿用 NestJS 11、Fastify、TypeORM 0.3、BullMQ；client 沿用 Next.js 16、React 19、MUI 9、pdf.js、signature_pad。無新增套件。

**Storage**: MySQL 8.4 沿用 `esign_signers` 既有欄位；個人副本沿用受控儲存；Redis 沿用既有 worker queue。

**Testing**: server Jest unit、真實 MySQL／Redis 的 e2e 與 security e2e；client 無自動測試框架，以 lint、build 與 quickstart 手動驗收。

**Target Platform**: 既有 HTTP server、獨立 worker 與 Next.js client；外部簽署人使用手機或桌面瀏覽器。

**Project Type**: pnpm workspace Web application（`client`、`server`）。

**Performance Goals**: 完成頁每 3 秒輪詢一次唯讀任務查詢，副本 `ready`／`failed` 即停止；副本產製沿用既有流程，目標為 95% 在 2 分鐘內可下載（SC-004）。

**Constraints**:
- 外部 cookie path 限 `/api/external-signing-task`，前端資料只能由瀏覽器呼叫 API 取得。
- 後端 HTML 頁的 CSP 為 `default-src 'none'`，只能用 inline style 與系統字型。
- GET 不得寫入業務資料或稽核。
- 邀請 token 不得進入 log、URL 以外位置或 client JavaScript。

**Scale/Scope**: 單一 esign feature 的外部流程；畫面 10 張設計稿（`docs/design/008-external-signing-flow/`）。建立人端正式串接不在範圍。

## Constitution Check

Phase 0 前檢查與 Phase 1 後複查均通過：

| 原則 | 設計依據 |
|------|----------|
| I. KISS／YAGNI | 不設下載期限，簽署寫入與資料欄位都維持現狀，不新增欄位、常數或環境變數。重用既有任務查詢分支與副本完整性檢查。只抽出外部流程確實會重複的簽名進度面板。 |
| II. Server 權威與證據 | 存取、簽署資格、期間、副本狀態全在 server 判斷。已簽證據、payload hash 與副本不變；下載沿用既有完整性驗證。 |
| III. 最小權限與資料最小化 | 依憲章 1.4.0 外部邀請條款：簽署用途仍有期限且可撤銷，簽署後只允許唯讀讀取本人結果與下載本人副本，不設期限、只在刪除時失效。每次請求重新驗證簽署人狀態、憑證與文件是否刪除。已簽者不能再簽、不能存取他人資料。開始時間只揭露給有效憑證持有人。不成為一般登入。（1.3.0 版條文要求簽署完成後邀請失效，原 plan 的憲章檢查漏看此點，已以修訂處理。） |
| IV. 清楚的系統邊界 | 新增 `GET /api/external-signing-task`（唯讀）與 `GET .../completed-file`（下載）兩個子資源，GET 不寫入。前端只透過 API contract 取資料。Controller → Service → Repository 不變。 |
| V. 與風險相稱的驗證 | 授權變更以 unit 與真實 DB e2e 覆蓋正常、授權失敗、重送、過期、尚未開始、停止後下載與 cookie 期限。前端完成前不宣稱產品完成。 |

本功能無 extension hooks 設定。

## Project Structure

### Documentation (this feature)

```text
specs/008-external-signing-flow/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/http-api.md
├── checklists/requirements.md
└── tasks.md                    # 由 speckit-tasks 產生（尚未建立）

docs/design/008-external-signing-flow/   # 設計稿靜態 HTML 與 README
```

### Source Code (repository root)

```text
server/src/features/esign/
├── controllers/external-signature.controller.ts   # GET 任務、GET 副本、session 尚未開始頁、簽署後重設 cookie
├── helpers/external-invitation-page.ts           # 新增：邀請確認／失效／尚未開始 HTML
├── helpers/external-signature-cookie.ts          # 沿用 set/clear
└── services/
    ├── esign-access-policy.service.ts            # assertExternalAccess／assertExternalInvitation
    ├── esign-signing.service.ts                  # 重送分支改用存取檢查（簽署寫入不變）
    ├── external-access.service.ts                # 改用存取檢查；completedFile；共用 readAccess
    └── esign-completion-access.service.ts        # completedFile 公開為 personalCopy
server/src/common/errors/app-errors.ts            # ESIGN_SIGNING_NOT_STARTED(startAt)、ESIGN_EXTERNAL_SIGNER_MISMATCH
server/src/features/esign/services/external-otp.service.ts   # 新增：Redis 驗證碼挑戰、冷卻、每小時計數
server/src/infrastructure/mail/                   # 驗證碼信內容與寄送方法
server/src/framework/interceptors/http-access-log.interceptor.ts   # 新增 OTP 路徑不記 body
server/src/config/app.environment.ts              # 各環境寄信 driver 改為 smtp；staging／production 必須驗證與加密
server/src/infrastructure/mail/                   # SMTP sender 依環境強制 TLS；移除 SES sender
server/package.json、pnpm-lock.yaml               # 移除 @aws-sdk/client-sesv2
server/.env.example、server/docs/internal-electronic-signature-platform.md   # 寄信設定說明
server/test/                                      # core-esign-flow、api-coverage、security-core-esign-flow

client/src/app/external-signatures/[signerPublicId]/page.tsx   # 新增
client/src/api/                                                # 沿用 dev 呼叫層
├── endpoints.ts           # 登記外部簽署端點
├── types/externalSigning.ts
├── requests/externalSigning.ts
└── queries/externalSigning.ts   # refetchInterval 輪詢副本狀態
client/src/features/external-signing/                          # 新增
├── taskForm.ts            # 任務 → DocumentViewer 資料
├── ExternalSigning.tsx    # 流程狀態：載入／同意／簽名／完成／失效／尚未開始
└── ExternalDone.tsx       # 完成頁：副本狀態輪詢與下載
client/src/features/my-signature/sign/
├── TermsStep.tsx          # 參數化聲明內容與返回按鈕
├── DocumentViewer.tsx     # 新增 pdfUrl 參數
├── SignProgressPanel.tsx  # 新增：自 SignFlow 抽出的簽名進度面板
└── SignFlow.tsx           # 改用 SignProgressPanel，畫面不變

specs/003-core-esign-flow/       # spec、contracts/external-invitation.md、contracts/openapi.yaml 加取代註記
specs/004-signature-verification-qr/spec.md   # 相容更新註記
```

**Structure Decision**: 外部授權規則集中在 `EsignAccessPolicyService`；外部專屬的 HTML 頁面放 esign helpers。前端外部流程獨立成 `features/external-signing`，只重用 `my-signature/sign` 的展示元件，不碰內部 mock 的 Server Action。

## 實作順序與交付邊界

1. **後端授權**：`assertExternalAccess`／`assertExternalInvitation`、`ESIGN_SIGNING_NOT_STARTED`、重送分支改用存取檢查；先寫 unit test。
2. **後端端點**：session 改用存取檢查與尚未開始頁、簽署後重設 cookie、`GET` 任務、`GET` 副本下載、source-file 改用存取檢查；更新 Swagger 說明。
3. **後端 HTML 頁**：`external-invitation-page.ts` 依設計稿產生邀請確認、失效、尚未開始三頁。
4. **後端 e2e**：新增 research.md 第 11 點情境，更新既有斷言；跑 lint、test、build、e2e、security e2e。
5. **前端共用元件調整**：`TermsStep`、`DocumentViewer` 參數化，抽出 `SignProgressPanel`；確認內部 `/my-signature/[id]` 畫面不變。
6. **前端外部流程**：路由、`features/external-signing`、完成頁輪詢與下載、手機底部操作區；跑 client lint、build。
7. **端對端手動驗收**：依 quickstart 桌面與手機寬度各走一次。
8. **邀請信 SMTP**：
   - 開發環境：後端環境變數範例檔記錄公司 Gmail SMTP 設定（`smtp.gmail.com`、587、`SMTP_SECURE=false` 以 STARTTLS、應用程式密碼），不含實際密碼；本機實寄驗證。
   - staging／production：寄信 driver 改為 `smtp`，必須設定帳密並強制加密；移除 SES 寄信實作、`SES_FROM` 與 `@aws-sdk/client-sesv2`；更新平台文件與 Spec 003 邀請契約的寄信說明。
   - 寄送失敗只留穩定錯誤碼，不記 SMTP 回應內容或密碼。
9. **文件同步**：Spec 003、004 加取代註記，更新 Spec 003 contracts。
10. **驗證碼（OTP）**：Redis 驗證碼服務與單元測試 → 驗證碼信 → `POST /api/external-signature-otps`、`POST /api/external-signature-session`（token＋code）、輸入頁與錯誤頁 → 重新寄送冷卻與每小時上限 → e2e（以 fake mail 攔截驗證碼）。
11. **送出簽名綁定簽署人**：外部簽名 body 帶 `signerPublicId`，不符回 409；前端送出時帶上；e2e 驗證同一文件兩位簽署人 cookie 覆蓋時被拒。
12. **提交前檢查**：`git status`、`git diff` 確認只有本規格範圍內的變更；commit 前由專案負責人確認並移除憲章的 Sync Impact Report。

部署：外部存取的變更只在 HTTP server，worker 的授權邏輯不需調整（寄信與副本產製只處理 `pending` 或依 `completion_status` 運作）。寄信改用 SMTP 後，staging／production 部署前必須先在部署環境設定 `ESIGN_MAIL_DRIVER=smtp` 與 `SMTP_*`（含應用程式密碼）並移除 `SES_FROM`，否則 worker 會因設定檢查失敗而無法啟動。無 migration。回滾到舊版時，舊版授權只放行 `pending`，已簽者的存取自動失效，不會擴大權限。

## Complexity Tracking

| 新增項目 | 為何需要 | 較簡單方案為何不足 |
|----------|----------|--------------------|
| `GET /api/external-signing-task` | 完成頁輪詢副本狀態（FR-013） | 用 POST 輪詢會每 3 秒寫一筆開啟稽核，且 GET 才符合唯讀語意 |
| `GET /api/external-signing-task/completed-file` | 外部簽署人下載本人副本（FR-012、FR-014） | 既有下載端點只接受建立人或內部員工 session |
| `ESIGN_SIGNING_NOT_STARTED` 錯誤定義 | 尚未開始時顯示開始時間（FR-003） | 沿用通用 401 會讓有效邀請看到「失效」，誤導簽署人 |
| `external-invitation-page.ts` | 三個後端 HTML 頁共用設計稿版型 | 原有 `html-error-page.ts` 只有純文字段落；改版後已無呼叫者，已刪除 |
| `SignProgressPanel` 抽出 | 內部與外部簽署都需要同一個進度、同意與送出面板 | 複製一份會造成兩份邏輯分歧 |
| `POST /api/external-signature-otps` 與 Redis 驗證碼挑戰 | 使用者 CR：開啟文件前驗證信箱控制權（FR-024～FR-031） | 只靠連結無法防止外流；MySQL 新表需 migration 與清理排程，對 10 分鐘的短期資料不划算 |
| `ESIGN_EXTERNAL_SIGNER_MISMATCH` 與簽名 body 的 `signerPublicId` | 防止 cookie 被覆蓋時以錯誤身分簽署（FR-032） | 欄位為文件共用，既有欄位檢查擋不下同一文件的不同簽署人 |
