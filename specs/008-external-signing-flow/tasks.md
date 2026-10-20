# Tasks: 外部簽署流程畫面與本人副本下載

**Input**: `specs/008-external-signing-flow/` 的 spec、plan、research、data-model、contracts/http-api 及 quickstart；設計稿 `docs/design/008-external-signing-flow/`。

**Branch**: 待建立，基底為 `dev`（`f7d89f0`）。Spec 008 會改動的後端檔案在 `dev` 與 `feature/007-reopen-signing` 內容相同；補簽服務只在後者，本功能不修改它。

**Scope**: 前後端皆由本規格交付。前端沿用 `dev` 的 `client/src/api` 呼叫層（requests → queries → 元件）。憲章已配合修訂為 1.4.0，commit 前由專案負責人確認。所有項目尚未實作。

**Tests**: 依 Constitution V 與 server/AGENTS.md，授權、簽署交易與檔案存取變更必須有測試。每個後端故事先加入能揭露未實作行為的測試再實作；client 沒有測試框架，以 lint、build 與 quickstart 手動驗收。不新增測試框架或套件。

**Format**: `- [ ] Tnnn [P?] [USn?] 說明與檔案路徑`。[P] 代表前置完成後可與同階段不同檔案的工作並行，不代表可略過依賴。

## Phase 1: Setup

**目的**：建立分支並確認實作基準，不安裝新套件。

- [ ] T001 從 `dev`（`f7d89f0`）建立功能分支；對照 `specs/008-external-signing-flow/plan.md` 確認 `server/src/features/esign/` 的 controller／service／helper、`client/src/api/` 呼叫層與 `client/src/features/my-signature/sign/` 元件的現況，只記錄會影響本功能的差異，不順便重構。
- [ ] T002 確認 `server/.env.test` 指向 `feastogether_intranet_test*` 測試庫，且 `server/test/core-esign-flow.e2e-spec.ts`、`server/test/security-core-esign-flow.e2e-spec.ts`、`server/test/api-coverage.e2e-spec.ts` 可在本機執行；把可執行指令與前置條件補進 `specs/008-external-signing-flow/quickstart.md`。

## Phase 2: Foundational

**目的**：備妥錯誤定義、存取政策與副本讀取共用基礎；完成後才開始各故事。

- [ ] T003 [P] 在 `server/src/common/errors/app-errors.ts` 與 `server/src/common/errors/app-errors.spec.ts` 新增定義函式 `ESIGN_SIGNING_NOT_STARTED(startAt)`：`AppErrorCode.ESIGN_STATE_CONFLICT`、HTTP 409、訊息「簽署尚未開始，請於 {yyyy/MM/dd HH:mm}（台北時間）後簽署」，時間以 `server/src/common/date-time.helper.ts` 的 `formatInTaipei` 產生。（FR-003）
- [ ] T004 [P] 在 `server/src/features/esign/services/esign-access-policy.service.spec.ts` 先加測試：
  - `assertExternalAccess`：待簽者在期間內通過；開始前丟 `ESIGN_SIGNING_NOT_STARTED`；期間後、文件停止、到期皆 401。
  - 已簽者「不比對 `invitation_expires_at`、文件狀態與簽署期間」：文件 stopped／expired／finalizing／completed 皆通過。
  - 共同條件：憑證不符、非 email 簽署人、簽署人或文件已刪除皆 401。
  - `assertExternalInvitation`：已簽者 401，待簽者沿用上述規則。
  （FR-003、FR-012、FR-015、FR-016、FR-018、FR-019）
- [ ] T005 依 T004 在 `server/src/features/esign/services/esign-access-policy.service.ts` 實作 `assertExternalAccess`，並把 `assertExternalInvitation` 改為「先通過存取檢查且必須是 `pending`」；尚未開始只在憑證有效、待簽、文件 active 且 now < signStartAt 時丟出，其餘期間外維持 401。（依賴 T003、T004）
- [ ] T006 [P] 在 `server/src/features/esign/services/esign-completion-access.service.ts` 把私有 `completedFile` 改為公開的 `personalCopy(document, signer)`，註明呼叫端須先完成授權；建立人與內部簽署人的下載行為不變，`server/src/features/esign/services/esign-completion-access.service.spec.ts` 照常通過。（FR-014）

**Checkpoint**：授權規則與副本讀取已就緒，既有內部與建立人流程測試全數通過。

## Phase 3: US1 — 外部簽署人從邀請信完成簽署（P1）🎯 MVP

**Goal**：點開邀請 → 確認開啟 → 同意聲明 → 閱讀與簽名 → 送出；尚未開始與失效有正確畫面。

**Independent Test**：發起含 Email 簽署人的文件，以邀請連結在桌面與手機寬度各完成一次簽署，建立人看到該簽署人已簽署；開始日在未來時看到「簽署尚未開始」。

### 後端

- [ ] T007 [P] [US1] 新增 `server/src/features/esign/helpers/external-invitation-page.ts` 與 `server/src/features/esign/helpers/external-invitation-page.spec.ts`：依設計稿 `01`～`04` 產生邀請確認、失效、尚未開始三頁的完整 HTML（深色「電子簽署」頁首、確認型卡片、48px inline SVG 圖示、viewport meta）；只用 inline style 與系統字型 `'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', system-ui, sans-serif`，不引用外部資源；所有動態值 HTML escape。（FR-001～FR-003、FR-021）
- [ ] T008 [US1] 在 `server/src/features/esign/services/external-access.service.ts` 與 `server/src/features/esign/services/external-access.service.spec.ts`：
  - `createSession`、`task`、`source` 改用 `assertExternalAccess`。
  - 抽出私有 `readAccess(token)`，共用 `source` 與 `signingSignerPublicId` 的憑證查詢。
  - 尚未開始時 `createSession` 不寫入 `external_invitation.opened`。
  （FR-003、FR-020）
- [ ] T009 [US1] 在 `server/src/features/esign/controllers/external-signature.controller.ts`：
  - `GET external-signature-invitations/:token` 改用 T007 的邀請確認頁，移除 `<button>` 上無作用的 `nonce`。
  - `POST external-signature-session`：409 回尚未開始頁且不設 cookie；400／401 回失效頁；503 回服務暫停頁。
  - 既有 CSP、`no-store`、`no-referrer` 不變；同步更新 `ApiOperation` 說明。
  （FR-001～FR-003、FR-019）
- [ ] T010 [US1] 在 `server/test/core-esign-flow.e2e-spec.ts` 與 `server/test/security-core-esign-flow.e2e-spec.ts` 驗證：
  - 邀請確認頁 200 HTML 且不寫 DB。
  - 開始日在未來：session 409、頁面含開始時間、沒有 `Set-Cookie`、沒有 opened 稽核。
  - 無效、竄改、已停止文件的待簽者：401 失效頁，內容不區分原因、不回顯 token。
  - 既有完整簽署流程照常通過。
  （FR-001～FR-003、FR-019；SC-001、SC-006）

### 前端

- [ ] T011 [P] [US1] 在 `client/src/api/endpoints.ts` 登記 `EXTERNAL_SIGNING_TASK`、`EXTERNAL_SIGNING_TASK_SOURCE_FILE`、`EXTERNAL_SIGNING_TASK_SIGNATURES`、`EXTERNAL_SIGNING_TASK_COMPLETED_FILE`；新增 `client/src/api/types/externalSigning.ts`（任務、簽名送出、簽署結果型別，依 `contracts/http-api.md`）與 `client/src/api/requests/externalSigning.ts`（POST 開啟任務、POST 送出簽名），並匯出於各自的 `index.ts`。（FR-004～FR-007）
- [ ] T012 [P] [US1] 在 `client/src/features/my-signature/sign/TermsStep.tsx` 加參數：聲明內容與版本由呼叫端傳入、可隱藏「不同意，返回」；內部 `/my-signature/[id]` 傳入原本的條款，畫面不變。（FR-005）
- [ ] T013 [P] [US1] 在 `client/src/features/my-signature/sign/DocumentViewer.tsx` 新增可選 `pdfUrl` 參數；未傳時維持 `/files/forms/{id}`。（FR-006）
- [ ] T014 [US1] 新增 `client/src/features/my-signature/sign/SignProgressPanel.tsx`，自 `client/src/features/my-signature/sign/SignFlow.tsx` 抽出簽名進度、「我已閱讀並同意上述文件內容」與「確認簽署」面板；參數控制是否顯示「拒絕簽署」與手機寬度是否固定在底部。`SignFlow` 改用它，內部畫面不變。（FR-007、FR-008、FR-021）
- [ ] T015 [US1] 新增 `client/src/features/external-signing/taskForm.ts`：把外部任務轉成 `DocumentViewer`／`getSignLayout` 需要的資料，欄位 `signature` → `sign`、`date` → `date`，百分比座標原樣帶入。（FR-006）
- [ ] T016 [US1] 新增 `client/src/features/external-signing/ExternalSigning.tsx`：
  - 狀態：載入 → 同意聲明 → 閱讀與簽名 → 送出 → 完成。
  - 使用 `StepFlow`、`SignaturePadDialog`、`ConfirmDialog`（`loading`）、T012～T015 的元件；不顯示拒絕簽署。
  - 每次送出產生一個 `requestId`，失敗重試沿用同一個。
  - 401 顯示與設計稿 `03` 相同內容的失效卡片；`ESIGN_SIGNING_NOT_STARTED` 顯示後端訊息；其他錯誤沿用 `SnackbarProvider`。
  - 畫面只顯示文件名稱、本人姓名與 Email、簽署期限。
  （FR-004～FR-009、FR-019）
- [ ] T017 [US1] 新增 `client/src/app/external-signatures/[signerPublicId]/page.tsx`：在 `(main)` 之外，只有深色「電子簽署」頁首與內容區，不顯示員工側邊欄；渲染 `ExternalSigning`。（FR-021）
- [ ] T018 [US1] 執行 `pnpm -C client lint`、`pnpm -C client build`；依 quickstart 第 1～3、8、9 步在桌面與手機寬度實際走完。

**Checkpoint**：外部簽署人可完成簽署；完成後的下載屬 US2，此時完成畫面只顯示簽署成功。

## Phase 4: US2 — 簽署完成後立即下載本人副本（P1）

**Goal**：簽完保留存取；完成頁自動輪詢副本狀態，可下載與建立人相同的本人副本；網路重試拿回既有結果。

**Independent Test**：簽署後留在完成頁，畫面由「產生中」自動轉為可下載；下載檔案與建立人下載的同一人副本相同；重送同一 `requestId` 回 200。

### 後端

- [ ] T019 [P] [US2] 在 `server/src/features/esign/services/esign-signing.service.spec.ts` 先加測試：外部簽署人重送同一 `requestId` 回既有結果（`repeated`）；已簽者以新 `requestId` 簽署為 401；簽署寫入維持「保留 `invitation_token_sha256`、清除 `invitation_token_ciphertext` 與 `invitation_expires_at`」。（FR-012、FR-017）
- [ ] T020 [US2] 依 T019 在 `server/src/features/esign/services/esign-signing.service.ts` 把兩處重送分支的外部檢查改為 `assertExternalAccess`；新簽名仍經 `assertPrincipal` → `assertExternalInvitation`，簽署寫入不變。（FR-017）
- [ ] T021 [US2] 在 `server/src/features/esign/services/external-access.service.ts` 與其 `.spec.ts` 新增 `completedFile(token)`：以 `readAccess` 授權後呼叫 `personalCopy`，未產生回 null；確認 `task(token, false)` 不寫 `document.opened`。（FR-013、FR-014、FR-020）
- [ ] T022 [US2] 在 `server/src/features/esign/helpers/external-signature-cookie.ts` 讓 `setExternalAccessCookie` 的期限可省略，省略時為 session cookie（不設 `Expires`）；在 `server/src/features/esign/controllers/external-signature.controller.ts`：
  - 簽署成功（201／200）不再清除 cookie，改以同一 token 設為 session cookie。
  - 新增 `GET external-signing-task`：唯讀、不需 Origin、`Cache-Control: private, no-store`，呼叫 `task(token, false)`。
  - 新增 `GET external-signing-task/completed-file`：200 回 PDF（`attachment; filename="completed.pdf"`、`private, no-store`、`nosniff`）；未產生 409 `ESIGN_PERSONAL_COPY_NOT_READY`。
  - 更新 `ApiOperation` 說明。
  （FR-010、FR-013、FR-014、FR-017、FR-020）
- [ ] T023 [US2] 在 `server/test/core-esign-flow.e2e-spec.ts`、`server/test/api-coverage.e2e-spec.ts`、`server/test/security-core-esign-flow.e2e-spec.ts`：
  - 簽署後 `Set-Cookie` 為 session cookie；GET 任務 200 且稽核筆數不增加。
  - 副本產生前下載 409，worker 處理後 200，內容與建立人下載的同一人副本相同。
  - 重送同一請求 200。
  - 改寫既有「簽署後重送與開啟任務皆 401」的斷言；`api-coverage` 登錄兩個新 GET（無 cookie 為 401）。
  - 新 GET 不需 Origin、錯誤不回顯 cookie。
  （FR-010、FR-013、FR-014、FR-017、FR-020；SC-003、SC-004、SC-006）

### 前端

- [ ] T024 [P] [US2] 在 `client/src/api/requests/externalSigning.ts` 加 GET 任務請求，新增 `client/src/api/queries/externalSigning.ts`（含 query key）：副本 `pending`／`processing` 時 `refetchInterval` 為 3000 毫秒，`ready`／`failed` 回傳 `false` 停止。（FR-013）
- [ ] T025 [US2] 新增 `client/src/features/external-signing/ExternalDone.tsx`，依設計稿 `08`～`10`：
  - 可下載：「下載已簽署文件」為一般 `<a href>` 指向下載端點（不用 Next.js Link、不經 axios）。
  - 產生中：按鈕停用並轉圈。
  - 產製失敗：顯示說明並請向文件發起人索取。
  - 提示「之後可隨時再次開啟邀請信中的連結下載」。
  （FR-013、FR-014；US2 驗收 1～3、5）
- [ ] T026 [US2] 在 `client/src/features/external-signing/ExternalSigning.tsx` 送出成功後切換到 `ExternalDone`；執行 client lint、build，依 quickstart 第 4、5 步驗收。

**Checkpoint**：簽署當下可下載本人副本。

## Phase 5: US3 — 之後重新開啟邀請連結下載（P1）

**Goal**：已簽者日後任何時間重新開啟連結都直接進完成頁；文件停止、到期、完成都不影響。

**Independent Test**：簽完關閉瀏覽器，用另一個瀏覽器開啟原連結，直接進完成頁並可下載；文件停止後、簽署期限過後仍可下載。

- [ ] T027 [P] [US3] 在 `server/src/features/esign/services/external-access.service.spec.ts` 先加測試：已簽者 `createSession` 通過且回傳的期限為 null（文件 active／stopped／expired／completed 皆同）；待簽者仍回傳 `invitation_expires_at`。（FR-011、FR-015、FR-016）
- [ ] T028 [US3] 在 `server/src/features/esign/services/external-access.service.ts` 讓 `createSession` 對已簽者回傳期限 null；`server/src/features/esign/controllers/external-signature.controller.ts` 依此設定 session cookie 或帶 `Expires` 的 cookie。（FR-011、FR-016）
- [ ] T029 [US3] 在 `server/test/core-esign-flow.e2e-spec.ts` 驗證：
  - 簽署後以沒有 cookie 的新請求重新建立 session：303，任務的 `signer.status = signed`。
  - 簽署後建立人停止文件：已簽者仍可建立 session 並下載；同一文件待簽者 401。
  - 以 fake timers 推進到簽署期限之後：已簽者仍可建立 session 與下載，待簽者 401。
  - 改寫既有停止競態的斷言：競態中簽署成功（201）時，之後建立 session 應為 303 而非 401。
  （FR-011、FR-015、FR-016、FR-018；SC-005）
- [ ] T030 [US3] 在 `client/src/features/external-signing/ExternalSigning.tsx` 開啟任務後若 `signer.status = signed`，直接顯示 `ExternalDone`，不出現同意聲明與簽名步驟；依 quickstart 第 6、7 步驗收。（FR-011；US3 驗收 1～3）

**Checkpoint**：三個故事皆可獨立驗收。

## Phase 6: US4 — 以驗證碼確認信箱後才能開啟文件（P1），與送出簽名綁定簽署人

**Goal**：按下開啟後寄出 6 位數驗證碼，驗證成功才建立存取；送出簽名比對頁面所屬簽署人。

**Independent Test**：有效邀請按下開啟收到驗證碼信，錯誤顯示剩餘次數、過期與冷卻正確，驗證成功才進入文件；同一瀏覽器 cookie 被另一位簽署人覆蓋時，舊分頁送出被拒。

- [ ] T031 [P] [US4] 新增 `server/src/features/esign/services/external-otp.service.ts` 與其 `.spec.ts`（先寫測試）：以 Redis 保存每位簽署人「驗證碼挑戰 `{ codeHash, attempts }`（TTL 10 分鐘）」、「重寄冷卻（TTL 60 秒）」、「每小時寄送計數（第一次寄送起 TTL 1 小時，達 5 即拒絕）」；`codeHash = sha256(簽署人 id + 驗證碼)`、timing-safe 比對、驗證成功或錯滿 5 次即刪除；驗證碼以 `crypto.randomInt(0, 1_000_000)` 補零 6 位。（FR-025～FR-027）
- [ ] T032 [P] [US4] 在 `server/src/infrastructure/mail/` 新增驗證碼信內容與寄送方法（smtp 與 fake 皆實作），主旨「電子簽署驗證碼」，內容只有驗證碼、「10 分鐘內有效」、文件名稱與「若非本人操作請忽略」，不含連結；單元測試驗證內容與不含連結。（FR-029）
- [ ] T033 [US4] 在 `server/src/features/esign/services/external-access.service.ts` 與其 `.spec.ts` 拆成「依邀請寄送驗證碼」（先做存取檢查：失效／尚未開始不寄信）與「以 token＋驗證碼建立 session」；寄信失敗不保留挑戰、不計次；記錄 `external_otp.sent`／`verified`／`failed`／`locked`（不含驗證碼），`external_invitation.opened` 改在驗證成功時記錄。（FR-024、FR-030、FR-031）
- [ ] T034 [US4] 在 `server/src/features/esign/controllers/external-signature.controller.ts`、`server/src/features/esign/helpers/external-invitation-page.ts`：新增 `POST external-signature-otps`（200 輸入頁、409 尚未開始、429 冷卻／上限、400／401 失效、503 寄信失敗）；`POST external-signature-session` 改收 `token`＋`code`（303 session cookie、401 錯誤或失效頁）；邀請確認頁表單改送 otps；依設計稿 `11`、`12` 新增輸入頁與錯誤頁（遮罩信箱、剩餘次數、可再寄送時間、垃圾郵件提示）；兩個 POST 套用 `AuthThrottlerGuard`；`server/src/framework/interceptors/http-access-log.interceptor.ts` 加入 otps 路徑不記 body。（FR-001、FR-024～FR-028、FR-031）
- [ ] T035 [US4] 在 `server/test/core-esign-flow.e2e-spec.ts`、`server/test/security-core-esign-flow.e2e-spec.ts`、`server/test/api-coverage.e2e-spec.ts`：以 fake mail 攔截驗證碼，驗證完整流程、驗證前無 cookie、錯誤 5 次失效、10 分鐘過期（fake timers）、60 秒冷卻與每小時 5 封、重寄使舊碼失效、失效與尚未開始不寄信、稽核事件、log 不含驗證碼；既有 e2e 的建立 session helper 改為經過驗證碼。（FR-024～FR-031；SC-007）
- [ ] T036 [US1] 送出簽名綁定簽署人：在 `server/src/features/esign/dto/signature-submission.dto.ts`（或外部專用 DTO）、`server/src/features/esign/controllers/external-signature.controller.ts`、`server/src/common/errors/app-errors.ts` 加入外部簽名必填 `signerPublicId`，與 cookie 對應簽署人不符回 409 `ESIGN_EXTERNAL_SIGNER_MISMATCH`、不建立簽署；`client/src/api` 外部簽名請求與 `client/src/features/external-signing/` 送出時帶頁面路由的 `signerPublicId`，收到此錯誤顯示其訊息；e2e 驗證同一文件兩位簽署人 cookie 覆蓋時舊分頁送出被拒、兩人皆未被誤簽。（FR-032；SC-008）
- [ ] T037 [US4] 執行 server lint:check、test、build、e2e、security e2e；依 quickstart 第 1-1、6、6-1 步驗收（實際收信需人工）。

**Checkpoint**：外部存取需通過驗證碼；簽名綁定頁面所屬簽署人。

## Phase 7: Polish & Cross-Cutting

- [ ] T038 [P] 在 `specs/003-core-esign-flow/spec.md`（US3 驗收 6、FR-016、FR-026）、`specs/003-core-esign-flow/contracts/external-invitation.md`（§4～§6）、`specs/003-core-esign-flow/contracts/openapi.yaml`（外部端點）與 `specs/004-signature-verification-qr/spec.md`（相容更新）加上「由 Spec 008 取代」註記；保留原文，不改寫成已完成。（FR-022）
- [ ] T039 全量驗證：`pnpm -C server lint:check`、`pnpm -C server test`、`pnpm -C server build`、`pnpm -C server test:e2e`、`pnpm -C server test:e2e:security`、`pnpm -C client lint`、`pnpm -C client build`；結果與未執行項目記錄於 `specs/008-external-signing-flow/quickstart.md`。
- [ ] T040 深度 code review：檢查 KISS、重複驗證、REST 語意、server-side 授權、token／cookie 不進 log 或錯誤訊息（含 `server/src/framework/interceptors/http-access-log.interceptor.ts` 的路徑清單）、回應不含其他簽署人資料；修正確認的問題並重跑 T039。
- [ ] T041 開發環境：在 `server/.env.example` 記錄公司 Gmail SMTP 設定（`SMTP_HOST=smtp.gmail.com`、`SMTP_PORT=587`、`SMTP_SECURE=false`、`SMTP_USER`／`SMTP_FROM` 為寄件帳號、`SMTP_PASSWORD` 留空並註明使用 Google 應用程式密碼），不含實際密碼；以本機 Gmail SMTP 實寄外部邀請信並開啟信中連結；以錯誤密碼驗證 notification log 只記 failed 與穩定錯誤碼。（FR-023）
- [ ] T042 staging／production：在 `server/src/config/app.environment.ts` 與其 `.spec.ts` 把 development／staging／production 的寄信 driver 改為 `smtp`（test 維持 `fake`），staging／production 必須設定 `SMTP_USER`／`SMTP_PASSWORD` 且必須加密（`SMTP_SECURE=true`，或 `false` 時強制 STARTTLS）；在 `server/src/infrastructure/mail/smtp-invitation-mail-sender.service.ts` 依環境設定 `requireTLS`；移除 `server/src/infrastructure/mail/ses-invitation-mail-sender.service.ts`、`mail.module.ts` 的 SES 分支、`SES_FROM` 與 `pnpm --filter` 移除 `@aws-sdk/client-sesv2`（更新 root lockfile）；更新 `server/src/infrastructure/mail/invitation-mail-sender.spec.ts`、`server/test/setup-e2e.ts`、`server/.env.example`、`server/docs/internal-electronic-signature-platform.md` 與 `specs/003-core-esign-flow/contracts/external-invitation.md`（§7～§8 加取代註記）。（FR-023）
- [ ] T043 提交前檢查：`git status`、`git diff` 只含本規格範圍；專案負責人確認並移除 `.specify/memory/constitution.md` 的 Sync Impact Report；交付摘要分開說明 client、server、config 變更、驗證結果與已知限制（外部下載存取不設期限且無撤銷入口，待法務確認）。
- [ ] T044 存取憑證與邀請 token 分離（code review 發現，research §15）：驗證碼成功時產生隨機存取憑證作為 cookie 值，Redis `esign:external-access:{sha256}` 存簽署人 id、TTL 8 小時；所有讀 cookie 的外部端點改以憑證查簽署人；簽署成功不重設 cookie；`DELETE` session 刪除 key；e2e 驗證以邀請 token 自行設 cookie 一律 401、Redis 過期後 401。（FR-024、FR-028、SC-007）

## Dependencies & Execution Order

### Phase Dependencies

- **Setup（Phase 1）**：無依賴。
- **Foundational（Phase 2）**：依賴 Setup；阻擋所有故事。T005 依賴 T003、T004。
- **US1（Phase 3）**：依賴 Foundational。
- **US2（Phase 4）**：依賴 Foundational；前端 T026 依賴 US1 的 `ExternalSigning.tsx`（T016）。
- **US3（Phase 5）**：依賴 Foundational；T030 依賴 T025（`ExternalDone`）。
- **US4（Phase 6）**：驗證碼部分依賴 US3（建立 session 的已簽者路徑）；T036 簽署人綁定只依賴 US2。
- **Polish（Phase 7）**：依賴所有故事完成。

### Within Each User Story

- 後端：測試（T004、T019、T027）先寫並確認失敗 → 實作 → e2e。
- 前端：`client/src/api` 型別與 requests → 共用元件調整 → feature 元件 → 路由 → lint／build → 手動驗收。

### Parallel Opportunities

- T003、T004、T006 可並行（不同檔案）。
- US1 的後端 T007 與前端 T011～T013 可並行。
- US2 的 T019 與 T024 可並行。
- 後端與前端可由兩人分頭進行，以 `contracts/http-api.md` 為介面。
- T038 可在任何時間點並行。

## Parallel Example: User Story 1

```text
同時進行：
T007 server/src/features/esign/helpers/external-invitation-page.ts
T011 client/src/api/endpoints.ts、types/externalSigning.ts、requests/externalSigning.ts
T012 client/src/features/my-signature/sign/TermsStep.tsx
T013 client/src/features/my-signature/sign/DocumentViewer.tsx
```

## Implementation Strategy

### MVP First（只做 US1）

1. 完成 Phase 1、2。
2. 完成 US1：外部簽署人能從邀請信完成簽署（目前完全無法簽署，是最大缺口）。
3. 停下來依 quickstart 驗收，再繼續。

### Incremental Delivery

1. Setup + Foundational → 授權基礎就緒。
2. US1 → 可簽署（MVP）。
3. US2 → 簽完可下載。
4. US3 → 日後可重新下載。
5. Polish → 文件同步、全量驗證、review、提交前檢查。
