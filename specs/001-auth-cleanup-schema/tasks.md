---
description: "舊授權清理與電子簽資料基礎實作任務"
---

# Tasks: 舊授權清理與電子簽資料基礎

**Input**: Design documents from `/specs/001-auth-cleanup-schema/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/README.md`, `quickstart.md`

**Tests**: 本 feature 涉及 authentication、migration、FK／unique／必要結構 CHECK 與 append-only 邊界；依 spec 與 Constitution V，相關單元、integration 及 e2e 測試均為必要任務。測試任務先建立失敗案例，再完成對應實作。

**Scope guard**: 不新增或啟用 WebView token login、SSO 正式入口或任何電子簽業務 API；不修改 client mock store。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可與同階段其他標記任務平行，且不修改相同檔案
- **[Story]**: 對應 `spec.md` 的 user story
- 所有路徑均相對 repository root

## Phase 1: Setup（共用驗證基礎）

**Purpose**: 建立 Spec 1 專用、fail-closed 的 schema 測試入口，不改動正式環境。

- [x] T001 在 `server/package.json` 新增只執行 schema migration integration 的 pnpm script，並建立 `server/test/jest-schema.json`；沿用 ts-jest、`#app/*` mapper 與 `.env.test`，不得新增 dependency 或讀取正式 `.env`
- [x] T002 [P] 在 `server/src/infrastructure/database/test/schema-test-database.ts` 與 `server/src/infrastructure/database/test/schema-test-database.spec.ts` 建立 disposable DB lifecycle helper；DB 名必須以 `feastogether_intranet_test` 開頭、每次使用唯一 suffix、finally 清理，任何不符名稱都 fail closed

---

## Phase 2: Foundational（所有 stories 的阻塞前置）

**Purpose**: 建立 RBAC 清理與電子簽 schema 共用的員工 principal 與稽核欄位基礎。

**⚠️ CRITICAL**: T003–T005 完成前不得開始 user story 實作。

- [x] T003 [P] 先在 `server/src/infrastructure/database/auditable.entity.spec.ts` 與 `server/src/infrastructure/database/audit.subscriber.spec.ts` 加入失敗測試，要求所有時間欄位為 `DATETIME(6)` 且各有專屬單欄 index，一般 `AuditableEntity` 不再產生 VARCHAR `created_by/updated_by`，user-auditable entity 才寫入 nullable BIGINT `created_by_user_id/updated_by_user_id`
- [x] T004 依 T003 重構 `server/src/infrastructure/database/base.entity.ts`、`server/src/infrastructure/database/auditable.entity.ts`、新增 `server/src/infrastructure/database/user-auditable.entity.ts`，並修改 `server/src/infrastructure/database/audit.subscriber.ts` 與 `server/src/infrastructure/database/audit-user.context.ts` 讓 CLS 員工 ID 以 BIGINT 語意寫入；append-only entities 不得繼承可更新／軟刪除基底
- [x] T005 在 `server/src/features/users/entities/user.entity.ts`、`server/src/features/users/entities/user.entity.spec.ts` 與 `server/src/features/users/repositories/user.repository.ts` 建立唯一 principal：`empid VARCHAR(32) UNIQUE`、`name VARCHAR(100)`、nullable `person_status/department_id/department_name/title_name/last_login_at/deleted_at`、`is_active DEFAULT 1`、`created_at/updated_at DATETIME(6)`；`last_login_at/created_at/updated_at/deleted_at` 各有專屬單欄 index；不得含 role、permission、description、password、`oauth_sub` 或 identity binding，repository 必須可用 ID／empid 查到 soft-deleted 員工以 fail closed

**Checkpoint**: User principal 與 audit base 可供 Auth 及 schema 共用。

---

## Phase 3: User Story 1 — 清除不需要的角色權限功能（Priority: P1）🎯 MVP

**Goal**: 系統建置、啟動與健康檢查不再依賴 role、permission、API registry、使用者管理或 RBAC seed。

**Independent Test**: 在沒有任何角色／permission 資料及 seed 的環境完成 server build、啟動與 health check；role、permission、users 管理路由為 404，所有非 `@Public()` route 預設要求有效員工 session 與 active user，不依賴 route registry metadata。

### Tests for User Story 1

- [x] T006 [P] [US1] 先改寫 `server/src/framework/guards/auth.guard.spec.ts` 建立失敗案例：`@Public()` 放行，所有未標 Public 的 route 無論是否有 metadata 都要求有效 session，guard 不呼叫任何 role／permission／authorization cache，inactive 或 soft-deleted user session 被拒絕，成功後直接套用 identity 並回傳 true
- [x] T007 [P] [US1] 先新增／改寫 `server/test/api-coverage.e2e-spec.ts` 與 `server/test/security-harness.e2e-spec.ts`，驗證未標 `@Public()` 的 endpoint 在無 session 時一律 401、公開例外具明確自身驗證責任、`/api/roles` 與 `/api/users` 不存在、health 不需 RBAC seed；移除建立角色／permission 的 fixture
- [x] T008 [P] [US1] 在 `server/src/features/auth/controllers/auth.controller.spec.ts` 加入失敗測試，要求 `/me` 契約不含 role、permission、navigation 或本地備註，dev login 不要求 ADMIN role，login options 仍回報 OAuth 未啟用

### Implementation for User Story 1

- [x] T009 [US1] 刪除 `server/src/framework/decorators/register-api.decorator.ts`，並重構 `server/src/framework/guards/auth.guard.ts`：只保留 `@Public()` 例外，其他 route 預設驗證 cookie session 與 active User，移除 `REGISTER_API_KEY`、`RegisterApiMetadata`、permission array、`ApiAuthorizationService`、authorization cache、`forbidden()` 與 authz metadata log；缺少／無效 session 回 401，資源授權 403 留給後續業務 service
- [x] T010 [P] [US1] 刪除純 RBAC entities 與 tests：`server/src/features/auth/entities/auth-api.entity.ts`、`auth-api-permission.entity.ts`、`auth-group.entity.ts`、`auth-group-job.entity.ts`、`auth-job-permission.entity.ts`、`auth-role.entity.ts`、`auth-role-permission.entity.ts`，並以 T005 的 User 取代 `auth-user.entity.ts`／`auth-user.entity.spec.ts`
- [x] T011 [P] [US1] 刪除角色／permission/API registry 程式與測試：`server/src/features/auth/controllers/role.controller.ts`、`server/src/features/auth/dto/create-role.dto.ts`、`rename-role.dto.ts`、`reorder-roles.dto.ts`、`set-role-permissions.dto.ts`、`server/src/features/auth/repositories/api-registry.repository.ts`、`permission.repository.ts`、`role-user.repository.ts`、`role.repository.ts`、`server/src/features/auth/services/api-authorization.service.ts`、`api-registry.service.ts`、`authorization-cache.service.ts`、`role.service.ts` 及同名 `*.spec.ts`
- [x] T012 [P] [US1] 刪除舊使用者管理程式與測試：`server/src/features/auth/controllers/user.controller.ts`、`server/src/features/auth/dto/batch-update-status.dto.ts`、`list-users.dto.ts`、`search-user-options.dto.ts`、`update-user.dto.ts`、`server/src/features/auth/mappers/auth-navigation.mapper.ts`、`role.mapper.ts`、`user.mapper.ts`、`group-by.ts`、`server/src/features/auth/repositories/user-account.repository.ts`、`server/src/features/auth/services/actor-display.service.ts`、`user-account.service.ts` 及其 `*.spec.ts`
- [x] T013 [P] [US1] 刪除舊管理 audit 與 RBAC seed：`server/src/features/auth/entities/audit-log.entity.ts`、`audit-log-target.entity.ts`、`server/src/features/auth/repositories/audit-log.repository.ts`、`audit-log-query.ts`、`server/src/features/auth/services/audit-log.service.ts`、`server/src/features/auth/seeds/permission-dictionary.ts`、`server/src/infrastructure/database/seeds/rbac.seed.ts` 及其 `*.spec.ts`；保留電子簽專用 `esign_audit_events` 規劃
- [x] T014 [US1] 清理 `server/src/features/auth/auth.module.ts`、`server/src/features/auth/auth.constants.ts`、刪除 `server/src/features/auth/api-keys.ts`，並更新 `server/src/config/config.path.ts`、`server/src/common/errors/app-error-code.ts`、`server/src/infrastructure/database/mysql/mysql.entity.service.ts` 與 `server/package.json`：移除 Discovery/API registry、RBAC providers/controllers/constants/error codes、`seed:rbac` 與舊 repository 集合；AuthModule 只以 `APP_GUARD` 提供全域員工 session guard，不註冊 AuthController/OAuthController，SSO/session/dev-login 原始能力留給獨立 testing module
- [x] T015 [US1] 從 `server/.env.example` 與 `server/.env.test.example` 移除只供 SUPER_ADMIN／RBAC seed 使用的設定並保留使用者既有無關修改；同步刪除 `server/test/roles.e2e-spec.ts`、`server/test/users.e2e-spec.ts`、`server/test/rbac-seed.e2e-spec.ts`
- [x] T016 [US1] 更新 `server/test/global-setup.ts`、`server/test/security-e2e.helper.ts`、`server/src/features/auth/controllers/auth.controller.ts`、`server/src/features/feature.module.ts` 與 `server/AGENTS.md`，移除 RBAC seed／role fixture／角色導覽回應及 `@RegisterApi` 慣例；FeatureModule 註冊只有 global guard providers、沒有 controllers 的精簡 AuthModule，文件規則改為「全域 guard 對所有非 `@Public()` endpoint 預設驗員工 session，Public 入口自行負責適用的 pre-session 驗證」，不得註冊或新增 SSO/dev/login/logout/me 入口
- [x] T017 [US1] 執行 `pnpm -C server lint:check`、`pnpm -C server test`、`pnpm -C server build` 及 US1 e2e，並以 `rg` 確認可執行 role／permission／user-management／API registry 入口及 `RegisterApi` 引用均為 0、所有非 Public endpoint 無 session 均為 401；將無法執行的外部服務前置與風險記入 `specs/001-auth-cleanup-schema/quickstart.md`

**Checkpoint**: 無 RBAC／管理端點也能 build、啟動與 health check；這是建議 MVP。

---

## Phase 4: User Story 2 — 保留未來可復用的 SSO 串接（Priority: P2）

**Goal**: SSO、員工編號對應、Redis session 與登出仍可由獨立 testing module 驗證，但正式 AppModule 不啟用 SSO。

**Independent Test**: OAuth start/callback、已驗證上游 `employee_number → users.empid`、session issue/verify/revoke 與 logout 測試全數通過且沒有 role／permission query；正式 runtime 的 global guard 生效，但 `/api/auth/*` 與 `/api/auth/oauth/*` 仍為 404。

### Tests for User Story 2

- [x] T018 [P] [US2] 先改寫 `server/src/features/auth/services/oauth-identity.service.spec.ts`，覆蓋以唯一 empid 找／建 User、缺員編拒絕、inactive／soft-deleted 拒絕、並發 unique conflict 重讀；移除 role、description、department_code 與 `oauth_sub` 持久化斷言
- [x] T019 [P] [US2] 先改寫 `server/src/features/auth/services/auth-session-verifier.service.spec.ts` 與 `server/src/framework/guards/auth.guard.spec.ts`，驗證 JWT + Redis 成功後仍查 User active/deleted 狀態，user 查詢失敗時 fail closed；`verifyToken()` 仍可供 logout 解析並撤銷已停用者 session
- [x] T020 [P] [US2] 先改寫 `server/src/features/auth/services/auth.service.spec.ts`、`oauth-login.service.spec.ts`、`dev-login.service.spec.ts` 與 `auth-logout.service.spec.ts`，要求 session response 只含必要 user profile、OAuth login 不呼叫 authorization cache、dev login 建立一般 synthetic user 且 production/staging fail closed
- [x] T021 [P] [US2] 改寫 `server/test/security-oauth-login.e2e-spec.ts`、`server/test/dev-login.e2e-spec.ts` 與 `server/test/oauth-runtime.e2e-spec.ts`：獨立 Auth testing module 驗證 state/nonce/replay、empid mapping、session/logout；正式 AppModule 驗證 OAuth route 404，且所有 fixture 改用 `users/empid`

### Implementation for User Story 2

- [x] T022 [US2] 將 `server/src/features/auth/repositories/oauth-identity.repository.ts` 與 `server/src/features/auth/services/oauth-identity.service.ts` 改用 `User`／`empid`／`name`，只更新受信任姓名與 `last_login_at`，不讀寫 role、permission、description 或 `oauth_sub`
- [x] T023 [US2] 在 `server/src/features/auth/services/auth-session-verifier.service.ts` 注入 User repository，讓每個受保護 request 在 JWT 與 Redis session 驗證後確認員工存在、`is_active=1` 且未 soft-delete；保留 `verifyToken()` 與 `revokeAllSessions()` 的登出／撤銷責任
- [x] T024 [P] [US2] 重構 `server/src/features/auth/services/auth.service.ts` 與 `server/src/features/auth/services/oauth-login.service.ts`，移除 permission/navigation/cache，JWT `sub` 僅使用 `users.id`，回應只揭露目前 session 必要的 user ID、empid、name、department/title 與登入時間
- [x] T025 [P] [US2] 重構 `server/src/features/auth/services/dev-login.service.ts` 與 `server/src/features/auth/auth.constants.ts`，改為非正式環境專用 synthetic developer user，不建立／查詢 ADMIN role 或 permission，production／staging 仍回 404/fail closed
- [x] T026 [US2] 精簡 `server/src/features/auth/auth.module.ts` 與 `server/src/features/auth/controllers/auth.controller.ts` 的 provider/response 組合：正式 AuthModule 只註冊 global guard/session verifier dependencies，OAuth/Auth controllers 與登入 services 僅由獨立 testing module 組合；保留 OAuth controller 原始碼及 session/logout 能力但正式 runtime 不得暴露 `/api/auth/*`，測試用 `login-options.oauth` 維持 `false`
- [x] T027 [US2] 執行 retained OAuth client/config/transaction/cookie/origin/throttle/session/logout 單元與 e2e 測試，以及 `pnpm -C server lint:check`、`pnpm -C server test`、`pnpm -C server build`；確認 log／錯誤不含 token、cookie、refresh token、個資或完整 provider response

**Checkpoint**: SSO/session 可獨立驗證且與 RBAC 無關，但 runtime 入口仍未啟用。

---

## Phase 5: User Story 3 — 建立電子簽資料基礎（Priority: P3）

**Goal**: 以乾淨 baseline migration 建立 12 張 Stage 1 tables、TypeORM entities、約束、索引、窄化 repository 與可重現 schema snapshot。

**Independent Test**: 在獨立 MySQL 8.4 空白測試 DB 完成 apply → 約束案例 → revert → reapply，12 張 tables 結構相同且舊 Auth/RBAC tables 為 0；TypeORM schema log 無差異。

### Tests for User Story 3

- [x] T028 [P] [US3] 先在 `server/src/features/users/entities/schema-metadata.spec.ts` 與 `server/src/features/esign/entities/schema-metadata.spec.ts` 建立失敗測試，逐一驗證 12 個 table 名稱、snake*case、繁中 comments、`DATETIME(6)`、boolean defaults、ASCII/binary hash/UUID、DECIMAL string mapping，並斷言 39 個 `DATE`／`DATETIME(6)` 欄位各有 `idx*<table>\_<column>`專屬單欄 index、signature/audit 無`updated_at/deleted_at`
- [x] T029 [P] [US3] 先建立 `server/test/schema-migration.e2e-spec.ts` 的失敗案例：空庫 apply、12 tables、39 個日期／時間欄位各有專屬單欄 index、舊 `auth_*`/role/permission/management audit tables 不存在、revert 清空、reapply 相同、TypeORM schema log 無 SQL diff
- [x] T030 [P] [US3] 在 `server/test/schema-constraints.e2e-spec.ts` 建立失敗案例，覆蓋 FK 斷鏈、unique/default、Email 大小寫防重、signer user/email XOR、file owner、`watermark_enabled=0`、`allow_reject=1`，並斷言 schema 僅保留這兩項必要結構 CHECK；透過 `information_schema.statistics` 證明每個 `DATE`／`DATETIME(6)` 欄位都有 column sequence 1 的單欄 index
- [x] T031 [P] [US3] 在 `server/src/features/esign/repositories/evidence-repositories.spec.ts` 建立失敗型別／行為測試：signature/audit repository 只有 insert/query，verification 只有 insert/query/revoke，均不暴露 general update/delete/soft-delete；文件有人 rejected 時 schema 可保留其他 signed/pending 狀態與最終實際結果

### Entities for User Story 3

- [x] T032 [P] [US3] 在 `server/src/features/users/entities/department.entity.ts` 建立 `hr_departments`：required `department_name VARCHAR(150)`，nullable self `parent_id`、`start_date/stop_date`，user-auditable 欄位；日期範圍交由 service 驗證，`start_date/stop_date/created_at/updated_at/deleted_at` 各有專屬單欄 index，另索引 `parent_id`，relation 不得 cascade/eager
- [x] T033 [P] [US3] 在 `server/src/features/esign/entities/esign-document.entity.ts` 與 `esign-document-field.entity.ts` 建立文件／欄位：document `doc_number CHAR(36) UNIQUE`、`watermark_enabled DEFAULT 0`、`allow_reject DEFAULT 1`；status、sign range、field type、page 與 percent 範圍交由後續 service 驗證；document 的 8 個與 field 的 3 個日期時間欄位各有專屬單欄 index，另套用 data-model 指定複合索引
- [x] T034 [P] [US3] 在 `server/src/features/esign/entities/esign-signer.entity.ts` 與 `esign-signature-record.entity.ts` 建立簽署人／證據：signer user/email 必須且只能一種，user 必須有 `user_id+empid_snapshot` 且 email NULL，external 必須有正規化 email 且 user/empid NULL；unique `(document_id,user_id)`、`(document_id,email)`；狀態與 timestamp 搭配交由 service 驗證；signer 的 5 個與 signature 的 2 個日期時間欄位各有專屬單欄 index；signature `signer_id` 與 `authentication_event_id` 均 UNIQUE，只有 `created_at` 且 hash 為 CHAR(64) ASCII binary
- [x] T035 [P] [US3] 在 `server/src/features/esign/entities/esign-file-object.entity.ts`、`esign-audit-event.entity.ts`、`esign-verification-record.entity.ts` 建立檔案／audit／驗證：file 四個 owner 至少一個非 NULL、object key case-sensitive 且 UNIQUE、不存公開 URL；file size、purpose、archive status 與 verification 狀態交由 service 驗證；file 的 1 個、audit 的 2 個、verification 的 3 個日期時間欄位各有專屬單欄 index；audit 另使用 `(document_id,occurred_at,id)` 與 unique event hash 且只有 `created_at`；verification 每文件及 public ID 唯一
- [x] T036 [P] [US3] 在 `server/src/features/esign/entities/esign-notification-batch.entity.ts`、`esign-notification-log.entity.ts`、`esign-export-job.entity.ts` 建立通知／匯出：filter、count、channel、result、export type 與 status 交由 service 驗證；batch 的 1 個、log 的 2 個、export 的 3 個日期時間欄位各有專屬單欄 index；log unique `(batch_id,signer_id,channel)`，並另建立 data-model 指定複合索引

### Persistence and Migration for User Story 3

- [x] T037 [US3] 在 `server/src/features/esign/repositories/signature-record.repository.ts`、`audit-event.repository.ts`、`verification-record.repository.ts` 實作 T031 的窄化介面；Email 正規化業務規則放在 `server/src/features/esign/services/esign-signer.service.ts` 並只做 trim + lowercase，禁止對 Email 外部簽署人建立 User
- [x] T038 [US3] 刪除 `server/src/infrastructure/database/migrations/1790812800000-AuthRbac.ts` 與 `1790812800001-AddAuthUsersOauthSub.ts`，新增單一 `server/src/infrastructure/database/migrations/1791763200000-InitialEsignSchema.ts`：依 departments → users → 回補 actor FK → documents → fields → signers → signatures → audit → verification → notification batches/logs → export jobs → file objects 建立，39 個 `DATE`／`DATETIME(6)` 欄位各建立固定名稱 `idx_<table>_<column>` 的專屬單欄 index，另建立必要複合索引與兩項結構 CHECK；使用固定 constraint 名稱、RESTRICT/NO ACTION、不以 `IF NOT EXISTS` 掩蓋漂移，down 先解除循環 FK 再反序 drop，up 失敗只 best-effort 清理本次已建立 objects
- [x] T039 [US3] 在 `server/src/infrastructure/database/mysql/mysql.options.ts` 明確註冊 12 entities 與 `InitialEsignSchema` migration，更新 `server/src/infrastructure/database/mysql/mysql.options.spec.ts`、`server/src/infrastructure/database/mysql/data-source.ts` 與 `server/test/global-setup.ts`；保持 `synchronize=false`、UTC、MySQL test DB fail-closed，禁止 glob 載入遺留 entity/migration
- [x] T040 [US3] 完成 `server/test/schema-migration.e2e-spec.ts` 與 `server/test/schema-constraints.e2e-spec.ts` 的 MySQL 8.4 fixtures/assertions，實際驗證 apply → constraints → revert → reapply、相同 normalized schema、`information_schema` 中 39 個日期／時間單欄 indexes 無缺漏，以及無效 signer identity／file owner／unique／FK 寫入都被 DB 拒絕
- [x] T041 [US3] 對套用乾淨 baseline 的 disposable development DB 執行 `pnpm -C server schema:dump`，以產生結果取代 `server/src/infrastructure/database/schema.sql`；不得手改 dump，確認包含 39 個日期／時間單欄 indexes，且不含 `auth_users`、role、permission、API registry 或舊 management audit tables
- [x] T042 [US3] 同步 `server/docs/internal-electronic-signature-data-dictionary.md` 與 `server/docs/internal-electronic-signature-er-model.md`：欄位／nullable/default/FK/兩項結構 CHECK/index 與 entities/migration 一致，明確列出每個 `DATE`／`DATETIME(6)` 欄位的專屬單欄 index，以及 MySQL DDL 非原子、Email 正規化、append-only repository 邊界及不保存 `oauth_sub`；不得宣稱跨列狀態機或業務 API 已完成
- [x] T043 [US3] 執行 `pnpm -C server test:schema`、`pnpm -C server lint:check`、`pnpm -C server test`、`pnpm -C server build`，並執行 TypeORM schema log 確認待產生 SQL 為 0、日期／時間欄位缺少專屬單欄 index 數為 0；若缺 MySQL 8.4／mysqldump，須在 `specs/001-auth-cleanup-schema/quickstart.md` 記錄未驗證項目與風險，不得宣稱 SC-004/006/007/012 通過

**Checkpoint**: 12-table baseline、entities、repositories、migration 與 schema snapshot 可重建且一致；沒有新增電子簽 API。

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 串聯三個 stories，清除殘留引用並執行完整交付 gate。

- [x] T044 [P] 更新 `server/test/jest-e2e.json` 與 `server/test/jest-e2e-security.json`，讓 retained OAuth/session、安全、route absence 與 schema suites 真正被對應 script 執行；不得只留下未被 testRegex 收錄的測試檔
- [x] T045 [P] 檢查並修正 `server/docs/internal-electronic-signature-platform.md`、`specs/001-auth-cleanup-schema/plan.md`、`research.md`、`data-model.md`、`contracts/README.md`、`quickstart.md` 的最終一致性；保留「SSO dormant、WebView login/API/跨列狀態機不在 Spec 1」限制
- [x] T046 依 `specs/001-auth-cleanup-schema/quickstart.md` 完成 server lint/unit/build、schema apply/revert/reapply、一般 e2e 與 security e2e；確認 inactive user fail-closed、正式 OAuth/role/users routes 404、敏感資料不進 log／response
- [x] T047 執行 root `pnpm build`、`pnpm lint`、`pnpm test` 與 `git diff --check`，確認沒有 npm/yarn lockfile、`.env` secret、個資、簽名圖、generated runtime artifacts 或與本任務無關的大範圍格式化差異
- [x] T048 依 Constitution 對 `specs/001-auth-cleanup-schema/spec.md` 的 FR/SC 建立交付核對結果，分開記錄 Client（無變更）、Server、migration/config、驗證結果與限制；不得把 schema、mock、dormant SSO 或 repository policy 描述成已完成的登入／簽署業務功能
- [x] T049 將 User、OAuth identity 與 evidence repositories 統一註冊為 `MysqlModule` providers；Repository 不得自行持有 `DataSource` 或開啟 transaction，改由 Service 取得／建立 `EntityManager` 後明確傳入，並以 unit、build、lint 與 MySQL/Redis e2e 驗證 DI 連線

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: 無前置，可立即開始。
- **Phase 2 Foundational**: 依賴 Phase 1；T003 測試先於 T004，T005 依賴 T004。
- **US1 / Phase 3**: 依賴 Phase 2；先測試 T006–T008，再完成 T009–T016，最後 T017 驗收。
- **US2 / Phase 4**: 依賴 US1，因兩者會修改相同 AuthModule、AuthGuard 與測試 fixtures；先完成 T018–T021 的失敗測試。
- **US3 / Phase 5**: entity tasks T028–T037 在 Phase 2 後可準備，但 baseline T038–T043 必須在舊 RBAC 清理完成後整合，避免 migration/options 引用已刪 entities。
- **Polish / Phase 6**: 依賴所有選定 stories 完成。

### User Story Dependencies

```text
Setup → Foundation → US1（清除 RBAC）→ US2（驗證保留 SSO）
                    └──────────────→ US3（12-table baseline）
US2 + US3 → Polish／full verification
```

- **US1 (P1)**: MVP；完成後系統已不需 RBAC，但尚未交付正式 schema baseline。
- **US2 (P2)**: 依賴 US1 的 Auth 邊界收斂，獨立驗收 dormant SSO/session。
- **US3 (P3)**: 共用 Foundation 的 User；entities 可與 US2 平行，但 migration/options/schema dump 整合需避開相同檔案衝突。

### Within Each User Story

- 標示「先」的測試必須先建立並確認能因缺少新行為而失敗。
- Entities／repository interfaces 先於 migration；migration 先於真實 MySQL constraint tests 與 schema dump。
- 不可為了讓測試通過而註冊正式 SSO 入口、加入 DB trigger、建立 document version table 或實作電子簽 API。
- 每個 checkpoint 都應能獨立說明已完成與尚未完成的能力。

## Parallel Opportunities

### User Story 1

```text
T006 AuthGuard unit tests
T007 route coverage/security e2e
T008 AuthController contract tests

T010 RBAC entities removal
T011 role/permission services removal
T012 user-management removal
T013 management-audit/seed removal
```

上述各組修改不同檔案；T014–T016 負責最後整合，需等刪除任務完成。

### User Story 2

```text
T018 OAuth identity tests
T019 session verifier/guard tests
T020 auth/login/dev/logout tests
T021 OAuth/dev e2e

T024 auth/oauth login services
T025 dev-login service
```

T022–T023 共享 User/session dependency，依序完成；T026 最後整合 module/controller。

### User Story 3

```text
T028 entity metadata tests
T029 migration lifecycle tests
T030 DB constraint tests
T031 evidence repository tests

T032 department entity
T033 document/field entities
T034 signer/signature entities
T035 file/audit/verification entities
T036 notification/export entities
```

所有 entity groups 完成後才執行 T038 baseline migration；T039–T043 依序整合與驗證。

## Implementation Strategy

### MVP First

1. 完成 Phase 1–2。
2. 完成 US1，移除 RBAC／permission／使用者管理 runtime dependency。
3. 停下執行 T017 的獨立驗收。
4. MVP 只代表「舊授權清理完成」，不代表登入或電子簽 schema 已全部交付。

### Incremental Delivery

1. **US1**: 啟動與 health 不再需要 RBAC。
2. **US2**: 證明保留的 SSO/session 可復用且仍 dormant。
3. **US3**: 建立並驗證完整 12-table baseline。
4. **Polish**: 全套驗證、文件一致性與交付限制核對。

### Suggested Commit Boundaries

- Foundation：user principal + audit base
- US1：RBAC/user-management cleanup
- US2：SSO/session decoupling
- US3a：entities + restricted repositories
- US3b：clean baseline migration + schema tests/snapshot
- Final：docs + full validation

## Notes

- `[P]` 只代表檔案與直接依賴允許平行，不代表可跳過 phase gate。
- 現有 `server/.env.example` 有使用者修改；T015 必須保留所有任務外差異。
- 所有現有 DB 可重建；已記錄舊 migration timestamp 的 DB 必須 reset，不能期待刪除／改寫 migration 後自動重跑。
- MySQL DDL auto-commit；migration 的 best-effort cleanup 不是原子 rollback。
- Spec 1 不建立 OpenAPI contract，因為沒有新增或啟用外部介面。
- Email 外部簽署人只建立 schema identity；本 tasks 不得新增假 User、裸 `@Public()` 簽署 route、邀請碼／OTP／外部 session 或簽署 API，這些由後續 spec 定義。
