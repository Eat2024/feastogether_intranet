---
description: "核心電子簽端到端流程的可執行實作任務"
---

# Tasks: 核心電子簽端到端流程

**Input**: Design documents from `/specs/003-core-esign-flow/`

**Prerequisites**: `plan.md`、`spec.md`、`research.md`、`data-model.md`、`contracts/`、`quickstart.md`

**Tests**: 本功能涉及身分授權、簽署證據、Hash、migration、公開邀請、檔案存取與並發；依 Constitution 必須包含對應的單元、整合與 e2e 測試。Client 目前沒有 test runner，以 lint、build 與 quickstart 人工驗收補足。

**Organization**: 任務依 user story 分組；Phase 1–2 建立所有故事共用且會阻擋後續工作的基礎，Phase 3–6 各自交付可驗收的使用者價值。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可與同階段其他標記任務平行處理，因為修改不同檔案且不依賴尚未完成的任務
- **[Story]**: 對應 `spec.md` 的 user story（US1–US4）
- 每項任務均列出實際或預定的明確檔案路徑

## 共用驗證原則

- 可重複使用的是「驗證程式碼」，不是先前請求的驗證結果；每次讀取、寫入、下載、簽署及 worker transition 都必須以當下 DB 狀態、Server UTC 與 persisted bytes 重新執行共用驗證。
- Controller 只處理 DTO、multipart、cookie、header、status code 與 stream；不得自行複製 creator/signer 關係、文件狀態、期限、欄位歸屬或 hash 判斷。
- `pdf-validation.service.ts` 統一負責 PDF 格式、大小、加密、頁數及 bytes SHA-256；`esign-document-validation.service.ts` 統一負責狀態、半開時間區間、source/payload 完整性及 transition 前置條件；`esign-access-policy.service.ts` 統一負責 creator、internal signer、external invitation 與 receipt 的 resource-level authorization；DTO constraint 仍由 `class-validator` 在 HTTP 邊界處理。
- Story service 必須呼叫上述共用服務並傳入 transaction 內重新讀取或 lock 後的 entity；不得快取 authorization 結果，也不得以另一套 helper、inline `if` 或 Client 宣告重做相同規則。只有驗證語意確實不同且已有測試證明時才新增 story-specific validator。

## Phase 1: Setup（共用套件與執行設定）

**Purpose**: 準備 PDF、Mailpit/SES、local/S3 私有檔案與沿用驗收系統模式的 BullMQ producer/worker 執行環境，只建立已確認環境所需的窄化 port/adapter，不建立通用 workflow/provider framework。

- [x] T001 從 repository root 以 pnpm 將 `pdf-lib`、`nodemailer`、`@aws-sdk/client-sesv2`、`@aws-sdk/client-s3`、`@nestjs/bullmq`、`bullmq` 與必要型別加入 server workspace，版本對齊 NestJS 11 與驗收系統可用組合，更新 `server/package.json` 與唯一 root `pnpm-lock.yaml`
- [x] T002 [P] 在 `server/src/config/app.environment.ts` 定義並驗證 `ESIGN_STORAGE_DRIVER`、`ESIGN_STORAGE_ROOT`、`ESIGN_S3_BUCKET`、`AWS_REGION`、`ESIGN_MAIL_DRIVER`、`SMTP_HOST`、`SMTP_PORT`、`SMTP_SECURE`、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_FROM`、`SES_FROM`、`EXTERNAL_SIGNING_ORIGIN`、`ESIGN_INVITATION_ENCRYPTION_KEY_B64`；固定 local=`smtp+local`、test=`fake+local temp`、staging/UAT=`ses+local shared volume`、production=`ses+s3`，不允許 production fallback 或 AWS access-key env，缺值時 fail fast，並在 `server/.env.example` 只加入 placeholder
- [x] T003 [P] 在 `server/src/bootstrap/app.bootstrap.ts` 設定 Fastify multipart 單檔 streaming 上限 20 MiB，並確認既有 cookie、formbody 與 OriginGuard 對 multipart/form write 仍生效

---

## Phase 2: Foundational（所有 user story 的阻擋前置）

**Purpose**: 建立正式電子簽 feature、資料庫窄化 migration、私有檔案、不可變 audit、PDF 驗證及安全 token 基礎。

**⚠️ CRITICAL**: 本階段完成前不得開始 user story 的業務 endpoint 或 UI 串接。

### 資料模型與 migration

- [x] T004 [P] 擴充 `server/src/features/esign/entities/esign-document.entity.ts`：`title` 維持「1–200 字；只能在 draft 修改」，status 支援 `draft | active | finalizing | completed | stopped`，新增 nullable UUID `finalization_lease_token` 與 nullable UTC `finalization_lease_expires_at`，並保留發起後期間、payload、完成及停止欄位不可變語意
- [x] T005 [P] 擴充 `server/src/features/esign/entities/esign-signer.entity.ts`：新增 unique UUID v4 `public_id`；`user_id / email` 維持二選一且 Email 先 trim + lowercase；新增 64-hex invitation digest、僅寄送待處理期間存在的 AES-256-GCM ciphertext、deadline expiry/delivery time，以及簽署時建立且終止後 30 日失效的 completion receipt digest/expiry
- [x] T006 [P] 擴充 `server/src/features/esign/entities/esign-document-field.entity.ts` 與 `server/src/features/esign/entities/esign-file-object.entity.ts`：field 新增 nullable `signer_id` 且發起前必須 non-null/同文件；`page_number` 為 1 至 source PDF page count；`0 <= x/y < 100`、`0 < width/height <= 100` 且不得超出頁面；signature PNG 必須以 `document_field_id` 對應欄位並保證每證據每欄位唯一
- [x] T007 [P] 擴充 `server/src/features/esign/entities/esign-notification-log.entity.ts`：`channel=email`，result 僅 `pending | processing | delivered | failed`，新增 `attempt_count`、`next_attempt_at`、`processing_started_at`、`completed_at`，錯誤只保存穩定且非敏感的 `error_code`
- [x] T008 依 T004–T007 建立可回滾 migration `server/src/infrastructure/database/migrations/1791936000000-CoreEsignFlow.ts`，加入 FK/check/unique/generated-key 約束，並同步 `server/src/infrastructure/database/schema.sql` 與 `server/src/features/esign/entities/schema-metadata.spec.ts`
- [x] T009 在 `server/test/schema-migration.e2e-spec.ts` 與 `server/test/schema-constraints.e2e-spec.ts` 驗證 migration run/revert/run、所有新欄位與約束，以及測試 DB fail-closed 保護

### 共用服務與安全邊界

- [x] T010 [P] 在 `server/src/infrastructure/file-storage/local-private-file-storage.service.spec.ts`、`s3-private-file-storage.service.spec.ts` 與 module config tests 先覆蓋共用 contract、隨機且不可覆寫 object key、root path traversal、同目錄 temp+atomic rename、S3 VersionId、SHA-256、stream read、刪除 orphan、Block Public Access/IAM failure、四環境 driver mapping 與 production 禁止 local fallback
- [x] T011 實作 `server/src/infrastructure/file-storage/private-file-storage.port.ts`、`local-private-file-storage.service.ts`、`s3-private-file-storage.service.ts` 與 `file-storage.module.ts`：業務只依賴 persist/read/delete/metadata port；local key resolve 後仍位於 `ESIGN_STORAGE_ROOT` 且 HTTP/worker 共用 volume；S3 使用 AWS SDK v3/default credential chain、private bucket 與必要 prefix；兩者都不掛 static、不回 bucket/presigned URL
- [x] T012 [P] 在 `server/src/features/esign/services/pdf-validation.service.spec.ts` 先覆蓋空檔、偽裝 MIME/extension、錯誤 `%PDF-` signature、損壞、加密、超過 20 MiB、超過 100 頁，以及有效 PDF 的實際大小/page count/SHA-256
- [x] T013 實作 `server/src/features/esign/services/pdf-validation.service.ts`，只信任 persisted bytes 與 parser 結果，不信任 filename、Content-Type、Client page count 或 Client hash
- [x] T014 [P] 在 `server/src/features/esign/services/esign-token.service.spec.ts` 先覆蓋 32-byte CSPRNG base64url 無 padding固定 43 字元 token、SHA-256 digest、AES-256-GCM round trip/錯誤 key，以及 receipt token 與 invitation token 分離
- [x] T015 實作 `server/src/features/esign/services/esign-token.service.ts`，確保 token 原值、digest、ciphertext 及完整邀請 URL 不進入 log/error/audit
- [x] T016 [P] 在 `server/src/features/esign/services/esign-consent.service.spec.ts` 固定單一繁體中文告知的 text/version/hash，驗證文字變更必須伴隨 hash/version 一致更新
- [x] T017 實作 `server/src/features/esign/services/esign-consent.service.ts`，由 Server 提供唯一 active 文案，不接受 Client 在發起時自選版本
- [x] T018 [P] 在 `server/src/features/esign/services/esign-audit.service.spec.ts` 先覆蓋 UTF-8 canonical JSON、字典序 key、UTC ISO-8601、previous hash、第一筆事件並發與敏感 metadata 裁切
- [x] T019 實作 `server/src/features/esign/services/esign-audit.service.ts` 並補齊 `server/src/features/esign/repositories/audit-event.repository.ts`：每次 append 都先 lock 穩定 document row，再讀取最後事件，signature/audit repository 保持 append-only
- [x] T020 [P] 建立 `server/src/features/esign/repositories/document.repository.ts`、`signer.repository.ts`、`document-field.repository.ts`、`file-object.repository.ts`、`notification.repository.ts`，所有 transaction 都接受 Service 傳入的 `EntityManager`，不得自行注入 `DataSource`
- [x] T021 [P] 建立共用驗證及測試 `server/src/features/esign/services/esign-access-policy.service.ts`、`esign-access-policy.service.spec.ts`、`esign-document-validation.service.ts`、`esign-document-validation.service.spec.ts`：集中 creator/internal signer/external invitation/receipt 授權、document/signer 狀態、`sign_start_at <= now < sign_end_at`、欄位同文件歸屬、source/payload hash 與讀取/下載/transition 前置條件；每次操作都重新執行且禁止其他 service/controller 複製相同判斷
- [x] T022 [P] 擴充 `server/src/common/errors/app-error-code.ts` 與 `server/src/framework/filters/exception.handler.ts`，加入穩定繁體中文電子簽錯誤，對無權或不存在資源統一 404、外部憑證問題統一 401，錯誤內容不得揭露文件、Email、token 或簽名資料
- [x] T023 建立 `server/src/infrastructure/bullmq/bull-root.module.ts`，沿用既有 `REDIS_HOST/PORT/PASSWORD/DB` 且 `maxRetriesPerRequest=null`；建立 `server/src/features/esign/esign-queue.constants.ts` 與 `esign-queue.module.ts` 註冊/export invitation、finalization、maintenance 三條 queue，再建立共用 DTO/mapper `server/src/features/esign/dto/esign-common.dto.ts`、`server/src/features/esign/services/esign-view.mapper.ts` 與 `server/src/features/esign/esign.module.ts`；HTTP module 只注入 producer，不註冊 processor/scheduler，並於 `server/src/infrastructure/database/mysql/mysql.module.ts` 統一註冊 T020 repositories/T021 validators

**Checkpoint**: Schema 可 migrate/revert，私有檔案、PDF parser、token、同意文案、audit chain、DTO 裁切與 Nest module 已可被各 story 使用。

---

## Phase 3: User Story 1－建立並發起不可變文件（Priority: P1）🎯 MVP

**Goal**: Creator 能上傳或替換草稿 PDF、設定內外部簽署人與欄位，經 Server 完整驗證後一次固定 payload/hash 並發起；外部簽署人只收到首次邀請 Email。

**Independent Test**: 以員工 A 建立 2 頁 PDF 草稿，加入員工 B 與 `candidate@example.test`，各配置 signature/date field 後發起；確認 active、固定 hash/payload、只產生一份 external invitation outbox，且任何後續修改都被拒絕且資料零異動。

### Tests for User Story 1

- [x] T024 [P] [US1] 在 `server/src/features/esign/services/esign-draft.service.spec.ts` 先覆蓋 creator-only CRUD、1–200 字 title、PDF 替換 commit/rollback/orphan cleanup、active 後所有 mutation 拒絕與草稿 soft-delete
- [x] T025 [P] [US1] 在 `server/src/features/esign/services/esign-initiation.service.spec.ts` 先覆蓋最多 50 signer/200 fields、內部 user 與 normalized external Email 唯一性/歧義、每 signer 至少一個 signature field、欄位頁碼/比例邊界、`sign_start_at < sign_end_at`、canonical payload/hash、發起與 draft mutation 競態
- [x] T026 [P] [US1] 在 `server/test/core-esign-flow.e2e-spec.ts` 建立 US1 e2e：creator-only 404、有效/偽裝/空/損壞/加密/20 MiB/100 頁 PDF 邊界、signer/field validation、active immutability、invitation outbox 單一性，以及 Redis enqueue 失敗不回滾已成立 active/outbox
- [x] T027 [P] [US1] 在 `server/src/infrastructure/mail/invitation-mail-sender.spec.ts` 先以共用 contract 覆蓋 fake/SMTP/SES adapters 的 invitation-only 內容、台北截止時間、固定 origin URL、無附件/其他 signer/內部網址、provider error 敏感資料裁切、四環境 driver mapping、SES sandbox 限制與 production 禁止 fallback

### Implementation for User Story 1

- [x] T028 [US1] 建立 `server/src/features/esign/dto/document.dto.ts`、`signer.dto.ts`、`field.dto.ts`、`initiation.dto.ts`，精確實作 `contracts/openapi.yaml` 的 multipart、50 signer、200 fields、百分比座標與日期期間輸入限制
- [x] T029 [US1] 實作 `server/src/features/esign/services/esign-draft.service.ts`：呼叫 T021 access/state policy 完成 creator-only list/detail/create/update/delete，並以 conditional `status=draft` 寫入；PDF 替換只呼叫 T013 驗證 persisted bytes，先存新 object、transaction hard-delete 舊 draft metadata、commit 後刪舊 bytes，不得 inline 重做授權、PDF 或狀態規則
- [x] T030 [US1] 擴充 `server/src/features/esign/services/esign-signer.service.ts`：只從 active users 建立 internal snapshot，external name 1–100 字且 Email 最長 255 字並 normalize；同文件 `(user_id)`/`(email)` 不重複且明顯跨類型歧義必須由 creator 修正
- [x] T031 [US1] 實作 `server/src/features/esign/services/esign-field.service.ts`：每個 field 屬於同文件 signer，page 1–實際 page count，座標/尺寸在頁內，signature/date only，sort order 穩定，發起前每 signer 至少一個 signature field
- [x] T032 [US1] 實作 `server/src/features/esign/services/esign-initiation.service.ts`：pessimistic lock document/signers/fields 後呼叫 T013/T021 共用驗證，套用 Server consent、固定選項、建立 canonical payload/hash、snapshot、external token/outbox/audit並在單一 transaction 轉 active；commit 後透過 `server/src/features/esign/services/esign-job-producer.service.ts` 以短 timeout best-effort enqueue `notificationLogId`，Redis 失敗只記去敏感 warning並交由 reconciliation，不回滾或同步寄信
- [x] T033 [P] [US1] 實作 `server/src/infrastructure/mail/invitation-mail-sender.port.ts`、`smtp-invitation-mail-sender.service.ts`、`ses-invitation-mail-sender.service.ts` 與 `mail.module.ts`：local 以 Nodemailer SMTP 投遞 Mailpit、test 注入 in-memory fake、UAT/production 以 Nodemailer SES transport + AWS SDK v3 `SESv2Client`/default credential chain 寄送；共用內容只含文件名稱、creator 姓名、台北截止時間、固定-origin invitation URL 與防轉寄提醒，不附 PDF 且不寄提醒或完成通知
- [x] T034 [US1] 實作 BullMQ consumer `server/src/worker/esign/external-invitation.processor.ts`、`esign-maintenance.scheduler.ts`、`esign-maintenance.processor.ts` 與 `esign-worker.module.ts`：invitation job 只含 `notificationLogId`，以 notification log CAS/attempt fencing 寄送；可預期 SMTP 失敗只由 DB `attempt_count/next_attempt_at` 控制，SMTP accept 後 fenced 設 delivered/clear ciphertext/audit；maintenance 以 `esign-maintenance:30s` scheduler 分批補入列 eligible/stale invitation outbox，註冊失敗 fail closed；重複 job 為 no-op且 consumer/scheduler只在 `server/src/worker.module.ts` 註冊
- [x] T035 [US1] 實作 `server/src/features/esign/controllers/documents.controller.ts` 與 `server/src/features/esign/controllers/signer-candidates.controller.ts`，提供 OpenAPI 的 candidate、document CRUD、signers、fields、initiations、creator source/history endpoints，PDF stream 一律 `private, no-store`/`nosniff`；controller 只處理 HTTP 邊界並委派 T021 policy，不得複製 business validation
- [x] T036 [P] [US1] 建立 `client/src/lib/api/esign.ts` 與 `client/src/features/forms/api.ts`，使用同源 `/api/esign/*` contract、明確 response/error 型別與 multipart 上傳，不再以 Client 傳入 user/hash/page count 作權威
- [x] T037 [US1] 將 `client/src/app/(main)/forms/page.tsx`、`client/src/app/(main)/forms/new/page.tsx`、`client/src/app/(main)/forms/[id]/edit/page.tsx`、`client/src/app/(main)/forms/[id]/signers/page.tsx` 改接正式 API，沿用現有 editor 元件完成真實 PDF 上傳/替換、internal/email signer 與 signature/date field 設定
- [x] T038 [US1] 改寫 `client/src/features/forms/actions.ts` 與 `client/src/features/forms/editor/UploadEditor.tsx` 的保存/發起流程：呈現 Server 驗證錯誤與 pending 狀態，發起成功後鎖定 UI，禁止 active 文件改 title/PDF/signer/field/period/options
- [x] T039 [US1] 更新 `client/src/app/(main)/forms/[id]/page.tsx`、`client/src/features/forms/FormsTable.tsx` 與 `client/src/features/forms/detail/SignerTable.tsx`，呈現 draft/active、簽署計數與外部邀請 pending/delivered/failed，不揭露 token/provider 細節

**Checkpoint**: US1 可獨立 demo；建立、草稿修改、PDF 替換、簽署人/欄位設定、發起、鎖定與首次外部 Email 邀請均使用正式 Server/MySQL/私有檔案流程。

---

## Phase 4: User Story 2－被指定者完成簽署（Priority: P2）

**Goal**: 內部與 Email 外部簽署人只能看到自己的固定任務，接受 Server 告知文案、以 Canvas 提交本人欄位，並形成唯一不可變證據；外部邀請簽署後立即失效並換發唯讀 receipt。

**Independent Test**: 對一份已發起文件，分別由指定員工與 external invitation 完成簽署；兩者只看到自己資料，每人只形成一筆 signature record，Server 同一 UTC 填入 date field，重放/並發/越權/過期/竄改全部不形成第二筆或局部成功。

### Tests for User Story 2

- [x] T040 [P] [US2] 在 `server/src/features/esign/services/esign-signing.service.spec.ts` 先覆蓋半開區間 `sign_start_at <= now < sign_end_at`、Server consent、PNG data URL 最長 400,000 字元/格式/欄位完整性、source/payload hash 重算、同一 `signed_at_utc`、request UUID 冪等、signer/document lock，以及成功 commit 後 finalization enqueue 失敗不回滾簽署證據
- [x] T041 [P] [US2] 在 `server/src/features/esign/services/external-access.service.spec.ts` 先覆蓋 43 字元 token、pending/active/deadline 綁定、可重開、簽署/停止/完成立即失效、path-scoped receipt、多文件同名 cookie 共存、receipt 不可讀 source 或執行 write
- [x] T042 [P] [US2] 在 `server/test/core-esign-flow.e2e-spec.ts` 加入 internal/external 完整簽署、相同 request 200、不同重放明確 conflict、未指定/跨文件/交換 publicId/fieldId、缺告知/缺欄位/非 PNG/過大 PNG/hash 竄改及 transaction rollback 案例
- [x] T043 [P] [US2] 在 `server/test/security-core-esign-flow.e2e-spec.ts` 驗證 invitation GET 不查 DB/不寫 audit、bridge POST 才設 HttpOnly Secure SameSite=Lax cookie、通用 401、token 不進 log/referrer、所有 cookie write 缺少或錯誤 Origin 均在 DB/token 查詢前 403

### Implementation for User Story 2

- [x] T044 [US2] 建立 `server/src/features/esign/dto/signing-task.dto.ts` 與 `server/src/features/esign/dto/signature-submission.dto.ts`：requestId UUID、Server consent version、`accepted=true`、1–200 signature inputs、field ID 與 PNG data URL 限制完全符合 OpenAPI
- [x] T045 [US2] 實作 `server/src/features/esign/services/esign-signing-task.service.ts`：統一呼叫 T021 access/document policy，讓內部 employee session 只能 list/open/download 本人指派；POST open append `document.opened`；task 僅回本人 snapshot/fields、文件 metadata、完整 consent 與整體計數，不另建 internal-only 狀態 validator
- [x] T046 [US2] 實作 `server/src/features/esign/services/external-access.service.ts`：GET bridge 僅格式檢查/HTML escaping；POST digest 命中 signer 後呼叫 T021 external policy 驗證 document/deadline/status、append opened 並 303 到乾淨 URL；每次 API 都重新呼叫同一 policy，簽署後清 access cookie 並建立只讀 receipt，禁止複製另一份 external 狀態規則
- [x] T047 [US2] 實作 `server/src/features/esign/services/esign-signing.service.ts`：先持久化本人每個 signature field PNG，再於單一 transaction lock entities 並呼叫 T013/T017/T021 共用驗證，寫唯一 evidence/file metadata、signer signed、audits；rollback 後清 orphan，date field 只取同一 Server UTC；commit 後若全員已簽，由 `server/src/features/esign/services/esign-job-producer.service.ts` best-effort enqueue `documentId`，失敗不回滾證據並交 reconciliation補入列
- [x] T048 [US2] 實作 `server/src/features/esign/controllers/signing-tasks.controller.ts`，提供 internal signing task list/open/source/signature endpoint，保持 employee session 與 resource-level 404 邊界；所有資源與狀態判斷委派 service/T021，不在 controller inline 驗證
- [x] T049 [US2] 實作 `server/src/features/esign/controllers/external-signature.controller.ts`，提供 invitation bridge/session/task/source/signature/clear-cookie endpoint，使用 `@Public()` 並在 HTTP 邊界套用既有 OriginGuard/header/cookie 設定；external credential/resource/state 驗證只委派 T046/T021，不在 controller 複製
- [x] T050 [P] [US2] 建立 `client/src/features/my-signature/api.ts`，將待簽列表、POST open、source stream 與 signature submission 對應 internal contract，requestId 由 client 產生但不攜帶身分、狀態或 hash 權威值
- [x] T051 [US2] 將 `client/src/app/(main)/my-signature/page.tsx`、`client/src/app/(main)/my-signature/[id]/page.tsx`、`client/src/features/my-signature/MySignTable.tsx`、`client/src/features/my-signature/sign/SignFlow.tsx` 改接正式 API，保留 Canvas/同意流程並只 render 本人 fields
- [x] T052 [US2] 建立 `client/src/app/external-signatures/[signerPublicId]/page.tsx` 與 `client/src/features/my-signature/external/ExternalSignFlow.tsx`，只透過 HttpOnly cookie 呼叫同源 external API，不讓 JavaScript、props、query string 或 analytics 取得 token
- [x] T053 [US2] 更新 `client/src/features/my-signature/sign/TermsStep.tsx`、`SignaturePadDialog.tsx` 與 `DocumentViewer.tsx`：呈現 Server text/version/hash、只允許 Canvas 手寫、確保每個 signature field 完成、禁止簽署人輸入日期並清楚處理已簽/逾期/通用失效狀態

**Checkpoint**: US2 可用既有 active fixture 獨立驗收；內外部路徑形成相同強度的唯一證據，且外部 credential 永遠不擴張為員工或跨文件權限。

---

## Phase 5: User Story 3－全員簽署後自動結案（Priority: P3）

**Goal**: 最後一人簽署後由 worker 安全產生包含所有簽名與日期的完成 PDF；只有驗證並保存成功後才 completed，creator 與該文件 signer 才能查看與下載。

**Independent Test**: 兩名 signer 依序簽署；第一人後仍 active，第二人後 worker 以 lease claim 產檔，最終只有一份 completed PDF/一次 completed audit；產檔失敗保持既有證據且可安全重試，舊 worker 失去 lease 後不可提交。

### Tests for User Story 3

- [x] T054 [P] [US3] 在 `server/src/worker/esign/document-finalization.processor.spec.ts` 先覆蓋 BullMQ job 僅含 documentId、重複/亂序/stalled redelivery、全員 signed、UUID lease token/5 分鐘 expiry、`status=finalizing AND token=:mine` CAS fencing、lease recovery、舊 worker orphan cleanup、產檔/保存/驗證失敗與 retry 不重複完成
- [x] T055 [P] [US3] 在 `server/src/features/esign/services/completed-pdf.service.spec.ts` 先覆蓋以原 PDF 為底、每張 PNG 只嵌入所屬 signature field、每個 date field 使用該 signer 的 Server UTC 轉台北 `YYYY/MM/DD`、page count/final SHA-256 重讀驗證
- [x] T056 [P] [US3] 在 `server/test/core-esign-flow.e2e-spec.ts` 加入最後兩人並發、單一 claim/completed object/audit、worker A lease 過期後 B fencing、BullMQ duplicate/retry、enqueue failure 後 reconciliation、失敗重試，以及 creator/internal/external receipt/未參與員工的完成狀態與下載授權

### Implementation for User Story 3

- [x] T057 [US3] 實作 `server/src/features/esign/services/completed-pdf.service.ts`，先呼叫 T013/T021 共用 persisted PDF 與 source/payload/evidence 完整性驗證，再以 `pdf-lib` 嵌入簽名 PNG 與權威日期，persist 後仍以同一驗證 primitive 重讀 MIME/page count/hash，不改寫 source/evidence或另建 worker-only hash validator
- [x] T058 [US3] 實作 BullMQ consumer `server/src/worker/esign/document-finalization.processor.ts`：job data 只含 documentId，短 transaction claim active→finalizing 並寫新 lease token/expiry、transaction 外產檔、第二 transaction 以同 token CAS 寫 completed metadata/audit/time/status；失敗 reset、Bull retry與 stale recovery 也必須 fenced，lost lease job 清 orphan 後 no-op
- [x] T059 [US3] 擴充 `server/src/worker/esign/esign-maintenance.processor.ts` 與 `server/src/worker/esign/esign-worker.module.ts`：在 T034 既有 30 秒 maintenance 上加入有上限的全員已簽 active document 與 stale finalization lease reconciliation，再 enqueue finalization queue；不得查 queue state 作業務判斷，且不能影響 invitation maintenance 的獨立運作
- [x] T060 [US3] 擴充 `server/src/features/esign/services/esign-view.mapper.ts` 與 `server/src/features/esign/controllers/documents.controller.ts`，提供 creator/該文件 signer 的 completed status/file/history；每次下載呼叫 T021 access policy 與 T013 persisted PDF/hash 驗證，未參與者及不符狀態 fail closed，不在 endpoint 複製授權或完整性判斷
- [x] T061 [US3] 擴充 `server/src/features/esign/controllers/external-signature.controller.ts`，提供 `/external-completions/{signerPublicId}` 的 status/completed-file/history，透過 T021 receipt policy 驗證 path-scoped receipt；終止 transaction 將 expiry 設為終止時間 +30 日，禁止另寫 completion-only receipt validator
- [x] T062 [US3] 更新 `client/src/app/(main)/forms/[id]/page.tsx`、`client/src/app/(main)/my-signature/[id]/page.tsx` 與 `client/src/features/my-signature/sign/ReadOnlyDocument.tsx`，顯示 active/finalizing/completed 並只在授權且 completed 時提供正式完成 PDF
- [x] T063 [US3] 建立 `client/src/app/external-signatures/[signerPublicId]/completion/page.tsx` 與 `client/src/features/my-signature/external/ExternalCompletion.tsx`，以 receipt 顯示處理中/完成/停止及完成 PDF，並明示清除 cookie 後無法從舊 invitation 復原

**Checkpoint**: US3 可從兩筆既有成功簽署開始獨立驗收；完成產物與結案是可重試、fenced、只完成一次的 worker 流程。

---

## Phase 6: User Story 4－停止錯誤流程並重新發起（Priority: P4）

**Goal**: Creator 可對 active 文件填理由停止，worker 在 deadline 後自動停止尚有 pending signer 的文件；舊文件與證據不變，新流程必須是全新 document。

**Independent Test**: 一份已有一人 signed、一人 pending 的 active 文件由 creator 停止，確認待簽與 invitation 立即失效、歷程及既有證據保留；再用修正 PDF 新建文件，確認 ID/doc number/source hash/payload hash 全部獨立且 signer 皆 pending。另以測試 clock 驗證 deadline stop。

### Tests for User Story 4

- [x] T064 [P] [US4] 在 `server/src/features/esign/services/esign-stoppage.service.spec.ts` 先覆蓋 creator-only、reason 1–500 字、active-only、已簽證據保留、pending access 失效、completed/finalizing 不可停止與簽署/停止 row-lock 競態
- [x] T065 [P] [US4] 在 `server/src/worker/esign/esign-maintenance.processor.spec.ts` 先覆蓋 scheduler 每 30 秒喚醒、有上限 batch、`now >= sign_end_at` 且仍有 pending 才停止、穩定原因「簽署期限已到」、既有證據保留、重複 maintenance job 不增加第二筆 stop audit、Redis outage 跨 deadline後恢復收斂及簽署 vs deadline 唯一結果
- [x] T066 [P] [US4] 在 `server/test/core-esign-flow.e2e-spec.ts` 加入手動停止、到期停止、停止後各類 access/sign/mutation 拒絕、角色裁切 history，以及新文件不沿用舊 signature/file/receipt/版本關聯案例

### Implementation for User Story 4

- [x] T067 [US4] 實作 `server/src/features/esign/services/esign-stoppage.service.ts`：lock document 後呼叫 T021 creator/state/time policy，以單一 transaction 寫 stopped time/reason、receipt terminal expiry 與 `document.stopped_by_creator` 或 deadline audit，不刪文件、signer、evidence/files，且不重寫 stoppage 專用的 creator/status validator
- [x] T068 [US4] 在 `server/src/features/esign/controllers/documents.controller.ts` 實作 stoppage subresource，委派 T067/T021 讓 completed/finalizing/非 creator 回穩定 conflict/404，並讓 stopped pending signer無法讀 source 或簽署；controller 不重複判斷
- [x] T069 [US4] 實作 `server/src/features/esign/services/esign-expiry.service.ts` 並由 `server/src/worker/esign/esign-maintenance.processor.ts` 呼叫：使用 Server UTC 與 document row lock 後套用 T021 transition/time policy 處理 deadline；BullMQ scheduler只負責喚醒，Redis timer、queue state、client 時鐘或 worker-local duplicate validator都不得成為權威
- [x] T070 [US4] 改寫 `client/src/features/forms/StopSigningButton.tsx` 與 `client/src/features/forms/actions.ts` 的停止流程，必填理由並呈現不可逆提示；停止後重新整理 server 狀態且不提供恢復或編輯
- [x] T071 [US4] 更新 `client/src/app/(main)/forms/[id]/page.tsx` 與 `client/src/app/(main)/forms/new/page.tsx`，讓「重新發起」只導向全新空白 draft 建立流程，不複製舊簽署結果、receipt、document ID 或 payload hash
- [x] T072 [US4] 更新 `client/src/features/forms/detail/SignerTable.tsx` 與 `client/src/app/(main)/my-signature/[id]/page.tsx`，依角色呈現已停止原因與裁切歷程，已簽者可追溯本人結果、pending signer 不再取得 source/sign action

**Checkpoint**: US4 的手動與到期停止都有唯一結果；更正只能建立全新文件，舊流程及已成立證據保持不可變。

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: 完成跨 story 的安全驗證、原型收斂、文件與全 workspace quality gates。

- [x] T073 [P] 在 `server/test/security-core-esign-flow.e2e-spec.ts` 完成跨故事安全矩陣：OriginGuard、frame policy、IDOR、hash tampering、token/path log redaction、PDF/PNG/cookie/session/完整 Email 不進 response/error/log或 BullMQ job data，確認 MySQL/storage 不可用時 fail closed；以同一組 cases 驗證各入口走 T013/T021，且 Redis outage 不觸發 HTTP 同步寄信/產 PDF或把 queue state 當簽署權威
- [x] T074 [P] 在 `server/test/api-coverage.e2e-spec.ts` 將 `specs/003-core-esign-flow/contracts/openapi.yaml` 的 26 個 operations 納入 API coverage，確認 method/status/envelope 與 resource-oriented URI 一致
- [x] T075 移除或隱藏 Spec 03 正式路徑中的拒簽、補簽、催簽、QR 公開驗證、一般匯出與 client-side 個人簽署 PDF 入口，調整 `client/src/features/my-signature/sign/RejectDialog.tsx`、`SignatureQr.tsx`、`DownloadSignedCopyButton.tsx`、`client/src/features/forms/ResignButton.tsx` 及相關 page references，但不建立替代 API
- [x] T076 將電子簽正式頁面完全脫離 `client/src/features/forms/store.ts`、`client/src/features/forms/mock.ts` 與舊 Server Actions 的業務權威；保留仍被其他原型使用的檔案時，於 `client/src/features/forms/types.ts` 清楚隔離 legacy 型別，禁止正式 API DTO 與 memory model 混用
- [x] T077 [P] 更新 `server/docs/internal-electronic-signature-platform.md`、`server/docs/internal-electronic-signature-data-dictionary.md` 與 `specs/003-core-esign-flow/quickstart.md`，記錄 HTTP/worker 邊界、local/test/UAT private volume 與 production private S3、local Mailpit/test fake/UAT SES sandbox/production SES、runtime IAM/default credential chain、migration/config、正式功能與拒簽/提醒/完成通知/版本/QR/長期封存限制
- [x] T078 依 `specs/003-core-esign-flow/quickstart.md` 執行 `pnpm -C server test:schema`、`lint:check`、`test`、`build`、`test:e2e`、`test:e2e:security`、`pnpm -C client lint`、`pnpm -C client build`、root `pnpm build` 與 `pnpm lint`，以隔離 `REDIS_DB` 執行並記錄任何因外部環境未能執行的項目與風險
- [x] T079 在 `server/test/core-esign-flow-queue.e2e-spec.ts` 建立真 HTTP + MySQL + 隔離 Redis + 最小 `EsignWorkerModule` 的 queue e2e，使用 local temp storage 與 fake mailer 並對 AWS adapters 作受控 contract mock：commit 後 enqueue failure/recovery、queue add 成功但重複 dispatch、相同 resource 不同 occurrence、不設固定 business jobId、duplicate/stalled retry、provider accept 後 crash、stale lease fencing、Redis outage 跨 deadline、四環境 driver mapping，以及 dev/test Redis DB 不互相污染
- [ ] T080 完成 quickstart 人工驗收並將結果記錄於 `specs/003-core-esign-flow/validation.md`：US1–US4、local Mailpit、UAT SES sandbox 已驗證收件人、local/UAT shared volume 跨重啟、production S3 Block Public Access/IAM/API stream、內外部瀏覽器、PDF 視覺位置、兩分鐘 finalization、60 秒 expiry、BullMQ dashboard/queue 不含敏感 payload、窄螢幕/keyboard/focus，以及 Network/props/log/storage 的敏感資料檢查

---

## Phase 8: Convergence

**Purpose**: 補齊程式碼與 `data-model.md` 明列稽核事件之間的落差，確保核心證據鏈可完整重建。

- [X] T081 [US1] [US2] 在 `server/src/features/esign/services/esign-draft.service.ts`、`esign-initiation.service.ts`、`esign-signing.service.ts` 補齊 `document.created`、每名 signer 的 `signer.assigned`、`consent.accepted`、`signature.submitted` 與 `signature.completed` 線性 audit，並更新 service 與 `server/test/core-esign-flow.e2e-spec.ts` 測試，確認事件不含 Email、token、IP、User-Agent 或 PNG

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: 無相依，可立即開始。
- **Phase 2 Foundational**: 依賴 Setup；完成前阻擋所有 user story。
- **US1（Phase 3）**: 依賴 Foundational；提供正式 draft/active fixture 與 invitation outbox，是 MVP。
- **US2（Phase 4）**: 依賴 Foundational；以預先建立的 active fixture 可獨立測試，但產品流程整合依賴 US1 的發起結果。
- **US3（Phase 5）**: 依賴 US2 形成成功 evidence；processor 單元測試可用 fixture 提前開發。
- **US4（Phase 6）**: 手動/到期停止依賴 US1 的 active 文件；保留既有 evidence 的案例依賴 US2 fixture，但不依賴 US3。
- **Phase 7 Polish**: 依賴本次要交付的 US1–US4 全部完成。

### User Story Dependency Graph

```text
Setup → Foundational → US1 ─→ US2 ─→ US3
                         └───────→ US4
                              US2 fixture ─→ US4 證據保留驗收
```

### Within Each User Story

- 先建立會失敗的 service/e2e 測試，再實作 DTO、service、controller/worker 與 Client。
- 資料模型與 repository 必須先於 transaction service；service 必須先於 endpoint/UI。
- 每個 transaction 都要先完成 resource authorization、state/time/hash revalidation，再寫 DB。
- 每個 story 在 checkpoint 進行獨立驗收，通過後才進下一優先級。

### Parallel Opportunities

- Phase 1 的 config 與 multipart 可平行；dependency task 單獨執行以避免 lockfile 衝突。
- Phase 2 的四組 entity、storage/PDF/token/consent/audit 測試及 DTO/error 可分檔平行；migration 與 BullRoot/queue/module wiring 等前項合併後再執行。
- 各 story 內標記 `[P]` 的 service/e2e test 可平行撰寫；Server API 與 Client API wrapper 可在 contract 固定後平行。
- Foundational 後，US1 與 US2 的 processor/service 單元工作可用 fixtures 平行，但正式端到端整合仍依 dependency graph 收斂。
- US3 finalization 與 US4 stoppage/expiry 修改不同 service/processor 檔案，可在 US2 evidence contract 固定後平行。

---

## Parallel Examples

### User Story 1

```text
Task T024: 草稿 CRUD/immutability service tests
Task T025: 發起 invariants/concurrency service tests
Task T026: US1 HTTP/security e2e tests
Task T027: invitation-only mailer tests
```

### User Story 2

```text
Task T040: 簽署 transaction/idempotency tests
Task T041: external invitation/receipt lifecycle tests
Task T042: internal/external signing e2e tests
Task T043: bridge/cookie/Origin security e2e tests
```

### User Story 3

```text
Task T054: finalization lease/fencing processor tests
Task T055: completed PDF embedding/hash tests
Task T056: completion concurrency/access e2e tests
```

### User Story 4

```text
Task T064: manual stoppage/race service tests
Task T065: deadline expiry/idempotency processor tests
Task T066: stop/restart/history e2e tests
```

---

## Implementation Strategy

### MVP First（US1）

1. 完成 Phase 1 Setup。
2. 完成 Phase 2 Foundational；確認 migration、storage、PDF parser、token 與 audit 可用。
3. 完成 Phase 3 US1；交付真實 PDF 上傳/替換、簽署人/欄位、發起鎖定與 external invitation Email。
4. 停下來依 US1 independent test 驗收，不把 UI 原型或 memory store 描述為已完成正式 API。

### Incremental Delivery

1. **US1**: Creator 能建立並固定一份正式 active 文件。
2. **US2**: 內部及外部 signer 能形成不可變成功證據。
3. **US3**: Worker 產生完成 PDF 並只結案一次。
4. **US4**: 錯誤/逾期流程可停止，修正只能建立新文件。
5. **Polish**: 跑完整安全矩陣、移除超出範圍入口、更新文件與驗收紀錄。

### Scope Guardrails

- 不實作拒絕/退回、補簽、依序簽署、催簽、批次通知、完成 Email、SMS 或範本後台。
- 不實作一般匯出、QR 公開驗證、證據包、PAdES-LT/LTA、個人數位憑證或長期封存。
- 不實作同一 document 的版本、版本關聯、舊簽署沿用、MinIO/多雲 storage framework、額外 Email provider 或 Redis/BullMQ 狀態權威；只實作已確認的 local/S3 storage 與 fake/SMTP/SES mail adapters，且不以固定 documentId/signerId jobId 當業務去重。
- 外部邀請是唯一 URL credential 例外，只能授權單一 signer/document；receipt 只提供終止狀態與完成 PDF。

## Notes

- `[P]` 只表示檔案與直接相依允許平行，不代表可跳過 Phase/Story dependency。
- 重複使用共用 validation service 不代表沿用舊驗證結果；敏感操作仍必須在 transaction lock 或最新 DB read 後重新呼叫相同程式碼。
- 所有程式、註解、UI 與可預期錯誤使用繁體中文。
- 不提交 `.env`、實際 PDF/PNG、SMTP/SES secret、AWS access key、invitation token、session、coverage、dist、`.next` 或 `node_modules`。
- 每完成一個 task 或合理小群組即可 commit；不得覆寫本來就存在的使用者變更。

---

## Phase 9: Convergence

**Purpose**: 依完成度稽核補強不可變證據、角色歷程、競態安全、契約一致性與範圍邊界。

- [X] T082 [US3] 依 FR-024、SC-006 與 Constitution II（partial），更新 `server/src/features/esign/services/completed-pdf.service.ts` 及測試：完成 PDF 必須逐筆重驗 signature record 的 source/payload/consent、signature PNG persisted hash/欄位歸屬，並以不可變 `signed_at_utc` 而非可更新 signer snapshot 產生日期
- [X] T083 [US4] 依 US4/AC2、OpenAPI history、T060/T072（missing），在 `server/src/features/esign/services/esign-document-query.service.ts`、controller、client internal/external result UI 與 e2e 補齊 creator／本人簽署人角色裁切歷程及停止原因；不得揭露其他簽署人事件或個資
- [X] T084 [P] 依 Constitution V、T040/T042/T056/T064–T066/T073/T079（partial），擴充 service、真 MySQL/Redis e2e 與 security tests，實際證明同 signer 並發重放、最後簽署／結案唯一性、source/payload/PNG 竄改、stop/deadline race、enqueue failure 後 reconciliation、stale lease、敏感資料裁切及 fail-closed
- [X] T085 [US1] 依 FR-016、FR-035 與 invitation contract（contradicts），在 `server/src/worker/esign/external-invitation.processor.ts` 於 provider accept 後以 signer 狀態、credential 與 claim fence 重驗 commit 資格，停止／簽署／到期競態不得寫入 delivered 或第二筆 audit，並補 processor race tests
- [X] T086 [P] 依 FR-034 與 T075（contradicts），從 `client/src/components/SideNav.tsx` 移除一般匯出入口，停用 `/forms/[id]/export`、`/forms/[id]/export/file`、`/export-history` 直接路由及正式可達的 QR／拒簽／補簽入口，保留 legacy 原型檔時不得被正式頁面引用
- [X] T087 依 OpenAPI 與 Constitution IV（partial），強制 JSON unknown property 與 multipart unknown field 拒絕，落實 documents `role/status` 查詢及 creator／signer history authorization，校正 external idempotent 200 contract，並以 API coverage/e2e 驗證 method/status/envelope
- [X] T088 [P] 依 plan/data-model storage decision（partial），將 source PDF object key 統一為 `documents/<document-public-uuid>/source/<random>.pdf`，替換仍維持同 prefix 且不含 filename/user/email，並更新 local/S3 contract tests
