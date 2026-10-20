# Research: 外部簽署流程畫面與本人副本下載

調查日期：2026-10-20。依本機程式、Spec 003／004／007 文件與 `docs/design/008-external-signing-flow/` 設計稿完成；沒有引入新的外部套件。

## 1. 已簽者的存取期限

**Decision**: 不設下載期限。簽署成功時沿用現行寫入：清除 `invitation_token_ciphertext` 與 `invitation_expires_at`，保留 `invitation_token_sha256`。外部存取檢查對已簽者不比對期限，只驗證憑證相符、email 簽署人、簽署人與文件未刪除。簽署服務的簽署寫入不需修改。

**Rationale**: 使用者於 2026-10-20 決定取消原暫定的 14 天，避免爭議；憲章同步修訂為 1.4.0，允許簽署後唯讀存取不設期限、不因停止或到期撤銷。現行簽署本來就保留 digest；停止、到期、補簽與寄信掃描都只處理 `pending`，已簽者的 digest 不會被清除。不需 migration、常數或環境變數。

**Alternatives considered**:
- 簽署後 14 天（原暫定）：使用者取消，期限截止可能引起留存爭議。
- 以 `invitation_expires_at` 存放很遠的未來時間：等於用假期限表達「不設期限」，語意不清。

## 2. 簽署成功後的瀏覽器存取

**Decision**: 簽署成功不再清除 `FT_ESIGN_EXTERNAL_ACCESS`，改以同一 token 重設為 session cookie（不設 `Expires`）；同一 `requestId` 重送時同樣重設。已簽者重新建立 session 時也發 session cookie。待簽者仍沿用 `Expires = invitation_expires_at`。`DELETE /api/external-signature-session` 維持可手動清除。

**Rationale**: 待簽時 cookie 的期限是簽署期限；簽署人若在期限前一刻送出，完成頁輪詢時 cookie 會過期，所以簽署成功時必須重設。已簽者沒有期限可設，用 session cookie 即可：關閉瀏覽器後重新點邀請連結就能取得新存取，不需在瀏覽器保存長期 cookie。cookie path 仍為 `/api/external-signing-task`。

**Alternatives considered**: 設定很長的 `Expires`（瀏覽器上限約 400 天）：仍是假期限，且在共用電腦上留下長期存取。

## 3. 授權檢查拆成「存取」與「簽署」

**Decision**: `EsignAccessPolicyService` 新增 `assertExternalAccess`，共同條件為憑證相符、email 簽署人、簽署人與文件未刪除：
- `pending`：另須 `now < invitation_expires_at` 且在有效簽署期間；簽署期間尚未開始時丟出「尚未開始」（見第 4 點）。
- `signed`：不比對期限、文件狀態與簽署期間，文件停止、到期或完成都可存取。

原 `assertExternalInvitation` 改為「先通過存取檢查，且必須是 `pending`」，只用於送出新簽名。開啟任務、讀原始 PDF、下載副本、建立 session 都改用存取檢查。簽署服務兩處「同一 `requestId` 重送」的分支改用存取檢查，讓已簽者的網路重試拿回既有結果（FR-017）。

**Rationale**: 現行重送分支用 `assertExternalInvitation`，但能走到重送分支的簽署人一定已是 `signed`，所以外部重送從來不可能成功；改用存取檢查後與內部簽署人的重送行為一致。新簽名仍經 `assertPrincipal` → `assertExternalInvitation`，已簽者不能再簽。

**Alternatives considered**: 在每個 service 方法各自判斷已簽／待簽：同一規則散落多處，違反 KISS 與不重複驗證原則。

## 4. 簽署期間尚未開始

**Decision**: 新增錯誤定義 `ESIGN_SIGNING_NOT_STARTED`（409，`AppErrorCode.ESIGN_STATE_CONFLICT`），以定義函式產生訊息「簽署尚未開始，請於 {yyyy/MM/dd HH:mm}（台北時間）後簽署」，時間以 `formatInTaipei` 轉換。只有在憑證完全有效、簽署人 `pending`、文件 `active` 且 `now < signStartAt` 時才丟出；其餘期間外情況維持通用 401。

建立 session 遇到此錯誤時，回 409 的「簽署尚未開始」HTML 頁，不設 cookie、不記 `external_invitation.opened`。其他外部 API 遇到時回 409 envelope，前端顯示同一則訊息。

**Rationale**: 邀請信在發起時就寄出，建立人可設定未來的開始日。開始時間只揭露給持有有效憑證的人，無效憑證仍走通用失效頁，符合 FR-003 與 FR-019。

**Alternatives considered**: 允許開始前進入文件但不能送出：會在開始前建立存取並記錄開啟，違反 FR-003。

## 5. 本人副本下載端點

**Decision**: 新增 `GET /api/external-signing-task/completed-file`，放在既有 cookie path 下。以存取檢查取得簽署人與文件後，呼叫 `EsignCompletionAccessService` 既有的副本讀取與完整性驗證（把私有的 `completedFile` 公開為 `personalCopy`，由呼叫端負責授權）。副本不是 `ready` 時回 409 `ESIGN_PERSONAL_COPY_NOT_READY`；成功回 `application/pdf`、`attachment`、`private, no-store`、`nosniff`。

**Rationale**: 建立人與內部簽署人的下載已共用同一段完整性檢查（簽署紀錄、payload hash、檔案歸屬、PDF hash），外部下載沿用可確保三者拿到同一份（FR-014）。GET 不寫業務資料，也不新增下載稽核（FR-020）。

**Alternatives considered**: 恢復舊的 `external-completions` 路由或 receipt：已被 Spec 003 移除且需另一套憑證，不採用。

## 6. 唯讀任務查詢（副本狀態輪詢）

**Decision**: 新增 `GET /api/external-signing-task`，回傳與 `POST /api/external-signing-task` 相同的任務內容，但不記錄 `document.opened`。直接使用 `ExternalAccessService.task(token, false)` 這個既有但未被使用的分支。`POST` 維持「開啟並記錄」語意。

**Rationale**: 完成頁在副本產生中時需要定期查詢狀態（FR-013）。若用 `POST` 輪詢，每次都會寫一筆開啟稽核；依憲章 GET 不得寫入業務資料，唯讀查詢應該是 GET。

**Alternatives considered**: 輪詢下載端點的 409／200：每次成功都會讀整份 PDF，且無法分辨產製失敗；在 POST 加參數控制是否記錄：同一 method 兩種語意，不符合 RESTful 原則。

## 7. 後端產生的外部頁面（邀請確認、失效、尚未開始）

**Decision**: 新增 `server/src/features/esign/helpers/external-invitation-page.ts`，依設計稿的確認型卡片版型產生完整 HTML：
- 深色「電子簽署」頁首，48px 圖示，標題、說明與提醒。
- 只用 inline style 與 inline SVG；所有動態值都經 HTML escape。
- 字型用系統字型（`'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', system-ui, sans-serif`）。
- 加上 viewport meta，支援手機。

邀請確認、失效與尚未開始三頁共用此 helper。既有 CSP、`no-store`、`no-referrer` 不變；`common/http/html-error-page.ts` 仍供其他功能使用，不改。

**Rationale**: 這三頁在使用者取得存取之前由後端直接回應，前端不參與。現行 CSP 為 `default-src 'none'`、`style-src 'unsafe-inline'`，不能載入外部字型或樣式表，但允許 inline style。順帶移除邀請確認頁 `<button>` 上沒有作用的 `nonce` 屬性。

**Alternatives considered**: 讓這三頁改由 Next.js 呈現：建立 session 的表單 POST 是後端端點，失效與尚未開始的回應發生在後端，改由前端呈現需要多一次導頁與額外的狀態傳遞。

## 8. 前端路由與資料流

**Decision**:
- 新路由 `client/src/app/external-signatures/[signerPublicId]/page.tsx`，放在 `(main)` 群組之外，不顯示員工側邊欄；root layout 已掛 `ReactQueryProvider` 與 `SnackbarProvider`，外部頁可直接使用。頁面只放外框與頁首，內容交給 Client Component。
- 資料一律由瀏覽器呼叫後端。外部 cookie 的 path 是 `/api/external-signing-task`，頁面請求不會帶上，Server Component 讀不到。
- 沿用 `dev` 既有的呼叫層架構（`client/src/api`：requests → queries → 元件）：
  - `api/endpoints.ts`：登記 `EXTERNAL_SIGNING_TASK`、`..._SOURCE_FILE`、`..._SIGNATURES`、`..._COMPLETED_FILE`。
  - `api/types/externalSigning.ts`：外部任務、簽署請求與結果型別。
  - `api/requests/externalSigning.ts`：開啟任務（POST）、查詢任務（GET）、送出簽名。
  - `api/queries/externalSigning.ts`：任務查詢 hook；副本 `pending`／`processing` 時以 TanStack Query 的 `refetchInterval` 每 3 秒重新查詢，`ready` 或 `failed` 回傳 `false` 停止。
  - `api/errorCodes.ts`：沿用既有 `ESIGN_EXTERNAL_UNAUTHORIZED`、`ESIGN_STATE_CONFLICT` 對照；尚未開始以後端 message 為準。
- 外部畫面放新 feature 目錄 `client/src/features/external-signing/`：
  - `taskForm.ts`：把任務轉成 `DocumentViewer` 需要的資料。
  - `ExternalSigning.tsx`：狀態轉換「載入 → 同意聲明 → 閱讀與簽名 → 完成／失效／尚未開始」。
  - `ExternalDone.tsx`：完成頁，依副本狀態顯示並提供下載。
- 重用既有元件：
  - `StepFlow`、`ConfirmDialog`、`SignaturePadDialog`：直接使用。
  - `TermsStep`：加參數接受外部聲明全文與版本，並可隱藏「不同意，返回」。
  - `DocumentViewer`：加 `pdfUrl` 參數；預設行為不變。
- 簽名進度面板從 `SignFlow` 抽出共用元件，內部畫面不變。外部版以參數關閉「拒絕簽署」，並在手機寬度固定於畫面底部。實作前先確認 `dev` 上 `my-signature/sign` 元件的最新版本，以其為準。
- 日期欄位顯示瀏覽器當天的台北日期，實際寫入 PDF 的日期以後端簽署時間為準。
- 每次送出產生一個 `requestId`，網路重試沿用同一個，以取得冪等結果。
- 下載使用一般 `<a href="/api/external-signing-task/completed-file">`，不用 Next.js Link，也不經 axios（瀏覽器直接下載附件）。

**Rationale**: 外部簽署與內部簽署的畫面、步驟與元件應一致（FR-021、設計稿）。沿用 `dev` 的呼叫層，前端只有一套 API 呼叫方式；`refetchInterval` 讓輪詢不需自寫計時器。

**Alternatives considered**: 另寫 fetch 呼叫層：與 `dev` 既有架構重複；直接複製 `SignFlow` 成外部版：重複邏輯。

## 9. 輪詢與副本狀態

**Decision**: 維持完成頁自動輪詢（使用者 2026-10-20 確認）。輪詢使用第 6 點的 `GET /api/external-signing-task`，不使用會記稽核的 POST。

**Rationale**: 副本由 worker 在簽署後非同步產生，簽署回應當下多半仍是 `pending`；本機紀錄顯示正常情況約 0.1 秒內完成，輪詢只在這段期間或 worker 延遲時發生，重新開啟連結時通常一次查詢就已是 `ready`。

**Alternatives considered**: 「按下載時才判斷副本狀態」可少一個端點，但使用者選擇維持自動更新。

## 10. 文件與契約同步

**Decision**: 本規格的 API 變更記錄在 `contracts/http-api.md`，同時更新：
- Spec 003：`spec.md` 的 US3 驗收 6、FR-016、FR-026 加上「由 Spec 008 取代」註記；`contracts/external-invitation.md` 的 §4～§6；`contracts/openapi.yaml` 的外部端點。
- Spec 004：相容更新註記。
- 後端 Swagger 的 `ApiOperation` 說明。

舊規格保留原文，只加取代註記，不改寫成本功能已完成。

## 11. 測試策略

**Decision**:
- **server unit**：
  - 存取政策：已簽者不論期限、文件停止或完成皆可；待簽開始前 409、期間外 401、憑證不符 401、刪除 401。
  - 簽署服務：簽署後保留 digest、清除密文與期限（沿用現狀）；外部重送回既有結果。
  - 外部存取服務與 HTML helper：escape 與時間格式。
- **server e2e（真實 MySQL／Redis）**：
  - 簽後任務 200、`Set-Cookie` 改為 session cookie（無 `Expires`）。
  - 重新建立 session 303，且只見完成狀態、不能再簽。
  - 副本產生前 409、完成後 200。
  - fake timers 推進到簽署期限之後，已簽者仍可建立 session 與下載；待簽者 401。
  - 簽後文件停止仍可下載。
  - 未來開始日：409 尚未開始頁、不設 cookie。
  - `GET` 任務不寫稽核。
- **既有 e2e 預期更新**：`core-esign-flow` 中簽後 401 的斷言、停止競態的 session 斷言、補簽流程簽後任務的斷言、`api-coverage` 外部端點清單。
- **security e2e**：新 GET 端點不需 Origin、錯誤不回顯 cookie。
- **client**：無自動測試框架，執行 `pnpm -C client lint`、`build`，並依 quickstart 在桌面與手機寬度實際走完流程。

## 12. 邀請信寄送管道

**Decision**: 開發、staging 與 production 都使用 SMTP 寄信（公司 Google Workspace，`smtp.gmail.com`）；automated test 維持 fake。
- 環境與寄信 driver 的對應改為 development／staging／production 皆為 `smtp`、test 為 `fake`，維持「環境與 driver 不符即啟動失敗」的既有規則。
- staging 與 production 必須設定 `SMTP_USER`、`SMTP_PASSWORD`，且必須加密：`SMTP_SECURE=true`（直接 TLS），或 `SMTP_SECURE=false` 時強制 STARTTLS（nodemailer `requireTLS`），不允許明文送出帳密。development 維持可不驗證、不加密，以支援本機 Mailpit。
- 移除不再使用的 SES 寄信實作、`SES_FROM` 設定與 `@aws-sdk/client-sesv2` 依賴；S3 與 `AWS_REGION` 仍供 production 檔案儲存使用。
- 不新增環境變數：是否強制加密由 `NODE_ENV` 判斷，帳密沿用既有 `SMTP_*`。

**Rationale**: 使用者於 2026-10-20 決定所有環境都用公司 email 寄信，SMTP 參數已備妥。改用 SMTP 後 SES 在任何環境都不會被選到，依憲章 I（不保留未使用的程式與依賴）移除。Gmail 在 587 埠支援 STARTTLS，但 nodemailer 在 `secure=false` 時只是「可用就升級」，必須明確要求才能避免帳密以明文送出。

**Alternatives considered**:
- staging／production 允許 SMTP 或 SES 二選一：多一條未要求的設定分支，等同 fallback。
- 保留 SES 程式但不使用：留下死碼與依賴，違反 KISS。
- 新增 `SMTP_REQUIRE_TLS` 環境變數：使用者未要求，依環境判斷即可。

**Risks**: Google Workspace 帳號有每日寄信上限；應用程式密碼輪替時需同步更新部署環境；寄件人依使用者 2026-10-20 決定維持 `einvoice@eatogether.com.tw`。

## 13. 驗證碼（OTP）

**Decision**:
- **端點**：邀請確認頁的表單改送 `POST /api/external-signature-otps`（建立驗證碼挑戰並寄信，回驗證碼輸入頁）；輸入頁送 `POST /api/external-signature-session`（`token`＋`code`，驗證成功才設 cookie 並 303）。輸入頁的「重新寄送」再送一次 `POST /api/external-signature-otps`。兩個表單都以 hidden 欄位帶 token，沿用既有 bridge 的 `no-store`、`no-referrer`、CSP 與 OriginGuard（`Origin: null`＋`Sec-Fetch-Site: same-origin`）。
- **順序**：先以既有存取檢查判斷邀請（失效 → 失效頁、尚未開始 → 尚未開始頁，都不寄信），通過後才產生驗證碼。
- **儲存**：Redis，key 以簽署人 id 區分：
  - 驗證碼挑戰：`{ codeHash, attempts }`，TTL 10 分鐘；驗證成功或錯滿 5 次即刪除。
  - 重寄冷卻：TTL 60 秒。
  - 每小時寄送計數：第一次寄送時設 TTL 1 小時，達 5 次即拒絕。
  - `codeHash` 為 `sha256(簽署人 id + 驗證碼)`，比對使用 timing-safe compare；不保存明碼。
- **產生**：`crypto.randomInt(0, 1_000_000)` 補零為 6 位。
- **寄送**：在 HTTP 請求中同步寄出（HTTP 端的 esign module 已匯入寄信模組），寄送失敗回可重試頁面、不保留挑戰；不走邀請信的 outbox 佇列（驗證碼 10 分鐘即失效，排隊重試沒有意義）。寄信介面新增「寄送驗證碼」方法與信件內容（只含驗證碼、10 分鐘有效、文件名稱，不含連結）。
- **cookie**：驗證成功一律設 session cookie（待簽者與已簽者相同），取代 §2 中待簽者「Expires＝邀請期限」的做法；邀請期限仍由 server 端授權檢查把關。cookie 值改為存取憑證（見 §15），不再是邀請 token。
- **稽核**：新增 `external_otp.sent`、`external_otp.verified`、`external_otp.failed`、`external_otp.locked`，metadata 不含驗證碼（`failed` 可記剩餘次數）；原有 `external_invitation.opened` 改在驗證成功時記錄。`esign_audit_events.event_type` 為 varchar(50)，無 CHECK，不需 migration。
- **log**：`/api/external-signature-otps` 加入 HTTP access log 的不記錄 body 路徑清單；驗證碼與 token 不進 log、錯誤訊息或稽核。
- **限流**：上述冷卻與上限之外，兩個 POST 端點加上既有 `AuthThrottlerGuard` 依 IP 限流。
- **重新寄送倒數**（ticket 11）：輸入頁的重新寄送按鈕在冷卻期間停用並倒數，以頁面內一段固定的 inline script 實作（依截止時刻計算，手機切到信箱 App 再回來也不失準）；CSP 加上 `script-src 'sha256-…'` 只放行該段內容，不開放 `'unsafe-inline'`。每小時上限可能要等數十分鐘，不倒數，改顯示可再寄送的時刻。錯誤頁的重新寄送一律可按，冷卻與上限由 otps 端點判斷。

**Rationale**: 使用者 2026-10-20 決定以驗證碼確認信箱控制權，降低連結外流後可長期開啟與下載的風險。驗證碼是短期、可自動過期的資料，依憲章 IV 放 Redis 比新增資料表簡單，也不需 migration。同步寄送能在畫面立即回報失敗。

**Alternatives considered**:
- MySQL 新增驗證碼資料表：需要 migration 與清理排程，對 10 分鐘的短期資料不划算。
- 走邀請信 outbox 與 worker：多一層延遲與重試狀態，驗證碼過期後的重試無意義。
- 以 cookie 暫存「已按開啟」狀態再輸入驗證碼：多一顆 pre-auth cookie，hidden token 欄位已足夠且沿用既有 bridge 模式。

**Risks**: 每次開啟多寄一封信，增加 Google Workspace 寄信量；驗證碼信可能被歸到垃圾郵件，輸入頁需提示。

## 14. 送出簽名綁定簽署人

**Decision**: 外部送出簽名的 request body 新增必填 `signerPublicId`（前端取自頁面路由）。後端以 cookie 取得的簽署人與之比對，不符回 409 `ESIGN_EXTERNAL_SIGNER_MISMATCH`（訊息「此頁面的簽署對象已變更，請重新開啟邀請信中的連結」），不建立簽署。內部簽署端點已在路徑帶 `signerPublicId`，不受影響。

**Rationale**: ticket 05 以暫時測試證實：同一瀏覽器先後開啟同一份文件兩位簽署人的邀請時，cookie 被覆蓋，舊分頁送出的簽名會被記為另一位簽署人（共用欄位的 id 相同，欄位檢查擋不下）。綁定頁面所屬簽署人即可阻擋，改動小。

**Alternatives considered**: 依簽署人區分 cookie 名稱或 path：cookie 數量隨邀請增加，且需改所有外部端點路徑；只靠 OTP：同一人通過兩次 OTP 時仍會覆蓋。

## 15. 外部存取憑證與邀請 token 分離

**Decision**: 驗證碼驗證成功時以 `crypto.randomBytes(32)`（base64url）產生存取憑證作為 `FT_ESIGN_EXTERNAL_ACCESS` 的值；Redis `esign:external-access:{sha256(憑證)}` 存簽署人 id，TTL 8 小時（沿用內部 WebView session 的 `WEBVIEW_SESSION_TTL_SECONDS` 數值，另立外部常數），不滑動。所有讀 cookie 的外部端點改為「憑證雜湊 → Redis 取簽署人 id → 讀簽署人與文件 → 既有 `assertExternalAccess`／`assertExternalInvitation`」；Redis 查無即 401，與邀請失效相同處理。簽署成功不再重設 cookie（憑證不變）；`DELETE /api/external-signature-session` 刪除 Redis key 並清 cookie。邀請 token 只用於邀請確認頁、寄送驗證碼與驗證碼驗證三個表單。

**Rationale**: 2026-10-20 code review 發現 cookie 值即邀請 token，而 token 就在邀請信連結中，只持有連結者可自行帶上 cookie 跳過驗證碼，違反 FR-024 與 SC-007。改為驗證成功才產生的隨機憑證後，憑證只存在通過驗證的瀏覽器（HttpOnly），伺服器只存雜湊。8 小時與內部 session 一致；session cookie 由瀏覽器保留時，伺服器端仍會到期。驗證碼已依賴 Redis，不新增依賴；不需資料表、migration 或環境變數。

**Alternatives considered**:
- 以伺服器 secret 簽章邀請 token 作為 cookie：需新增 secret 環境變數，且無法在伺服器端使其失效。
- MySQL 存外部 session：需 migration 與清理排程，短期資料放 Redis 較簡單（憲章 IV）。
- 不設伺服器端期限：session cookie 可能被瀏覽器的「還原分頁」長期保留，無法保證重新驗證。

**Risks**: Redis 資料遺失時外部簽署人需重新開啟邀請並驗證（不影響簽署證據）；簽署中途超過 8 小時需重新驗證。

