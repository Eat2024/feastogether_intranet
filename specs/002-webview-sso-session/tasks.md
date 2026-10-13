---
description: "Spec 2 WebView SSO 與員工 Session 實作任務"
---

# Tasks: WebView SSO 與員工 Session

**Input**: Design documents from `/specs/002-webview-sso-session/`

**Prerequisites**: `plan.md`、`spec.md`、`research.md`、`data-model.md`、`contracts/`、`quickstart.md`

**Tests**: 本功能涉及身分驗證、session、migration、重放及並發風險，依 Constitution 必須包含單元、e2e 與 security e2e；各 story 的測試任務應先完成並確認在實作前失敗。

**Organization**: 任務依 User Story 分組；Setup 與 Foundational 是所有 story 的共同阻擋項。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可與同階段其他不同檔案、無未完成相依的任務平行執行
- **[Story]**: 對應 `spec.md` 的 US1、US2、US3
- 每項任務均包含實際檔案路徑

## Phase 1: Setup（共用環境）

**Purpose**: 準備標準 HTML form POST 與受控 WebView SSO 設定。

- [X] T001 新增 `@fastify/formbody` 至 `server/package.json` 與 root `pnpm-lock.yaml`，並在 `server/src/bootstrap/app.bootstrap.ts` 的共用 `registerFastifyPlugins()` 註冊，使正式及 e2e app 都能解析 `application/x-www-form-urlencoded`
- [X] T002 [P] 在既有 `server/src/features/auth/services/auth.service.ts` 與 `server/src/features/auth/services/auth.service.spec.ts` 加入啟動即 fail-closed 的 issuer、audience、base64 PEM 公鑰與固定 launch origin 設定讀取，並只把範例值加入 `server/.env.example`；不新增獨立 config service

---

## Phase 2: Foundational（所有 User Story 的阻擋項）

**Purpose**: 建立唯一 MySQL launch/session 權威、不可逆 credential 摘要及共用 HTTP 契約。

**⚠️ CRITICAL**: 本階段完成前不得開始任何 User Story 實作。

- [X] T003 [P] 先在 `server/src/features/auth/entities/auth-session.entity.spec.ts` 寫 TypeORM metadata 測試，鎖定 `auth_sessions` 表、繁中 comments、User FK、所有 unique／複合／時間索引與 AuditableEntity 基底欄位
- [X] T004 建立 `server/src/features/auth/entities/auth-session.entity.ts`：欄位約束必須精確為 `id BIGINT unsigned PK`、`user_id BIGINT nullable FK → users.id`（沿用既有 signed PK）、`source VARCHAR(20) non-null` 且由流程明確寫入 `webview`、`status VARCHAR(20)` 且只允許 `validating|pending|active|failed|revoked`、三個 nullable 規則依 data model 的 `CHAR(64)` SHA-256 欄位（其中 `source_jti_hash` non-null，三者皆 unique）、`assertion_expires_at DATETIME(3)`、其餘 lifecycle timestamps nullable `DATETIME(3)`、`failure_code VARCHAR(50) nullable`、`created_at/updated_at/deleted_at`；建立 `(status, launch_expires_at)`、`(status, expires_at)`、`(user_id, created_at)`、`deleted_at` 索引且認證流程不得 soft-delete 紀錄
- [X] T005 [P] 先更新 `server/test/schema-migration.e2e-spec.ts`，要求第二支 migration 可 apply → 無 drift → revert 只移除 `auth_sessions` → reapply，允許這一個 `auth_*` 表但仍拒絕其他 legacy auth tables，並驗證 FK、三個 unique 摘要索引及所有 lifecycle time indexes
- [X] T006 建立可回滾的 `server/src/infrastructure/database/migrations/<timestamp>-CreateAuthSessions.ts`，同步更新 `server/src/infrastructure/database/schema.sql`、`server/src/infrastructure/database/mysql/mysql.options.ts` 與 `server/src/infrastructure/database/mysql/mysql.options.spec.ts` 註冊 AuthSession 及第二支 migration
- [X] T007 [P] 先在 `server/src/features/auth/repositories/auth-session.repository.spec.ts` 寫 repository contract 測試，覆蓋 unique `jti` claim、validating→failed／pending、pending→active 條件更新、有效 session 摘要查詢、active→revoked 冪等更新與不得 soft-delete
- [X] T008 實作 `server/src/features/auth/repositories/auth-session.repository.ts` 並在 `server/src/infrastructure/database/mysql/mysql.module.ts` 註冊匯出；所有方法接收 Service 提供的 `EntityManager`，不得自行注入 DataSource
- [X] T009 先在既有 `server/src/features/auth/services/auth.service.spec.ts` 寫測試，驗證 launch code 與 session token 各由 32 CSPRNG bytes 產生為無 padding、43 字元 base64url，並以 lowercase hex SHA-256 儲存；`jti` 摘要輸入固定為 `issuer + NUL + jti`
- [X] T010 在既有 `server/src/features/auth/services/auth.service.ts` 以私有方法實作 credential 產生、格式驗證及摘要，不新增單一用途 helper；不得把原始 JWT、`jti`、code 或 session token寫入回傳錯誤或 log
- [X] T011 [P] 在 `server/src/features/auth/dto/webview-launch.dto.ts`、`server/src/features/auth/auth.constants.ts`、`server/src/config/config.path.ts` 與 `server/src/common/errors/app-error-code.ts` 定義 43 字元 base64url form `code` DTO、60 秒 launch／8 小時 session 常數、`FT_ESIGN_SESSION` cookie、resource routes及穩定通用錯誤碼，不新增 OAuth access-token 或任意 redirect contract
- [X] T012 [P] 更新 `server/src/features/auth/helpers/auth-cookie.ts` 與 `server/src/features/auth/helpers/auth-cookie.spec.ts`，只用 host-only、`Path=/`、`HttpOnly`、`SameSite=Lax`、production/staging `Secure` 的 `FT_ESIGN_SESSION`，固定 `Max-Age=28800` 且不滑動續期

**Checkpoint**: MySQL schema、repository、AuthService credential/config 私有流程、DTO 與 cookie boundary 可供所有 story 使用。

---

## Phase 3: User Story 1 - 從主平台無縫進入電子簽（Priority: P1）🎯 MVP

**Goal**: 主平台後端以 RS256 JWT 取得一次性 launch URL；WebView GET 唯讀 bridge、自動 POST code，取得本地 session cookie 後進入固定首頁。

**Independent Test**: 對 FGAPI 可精確查得的員工簽發有效 JWT，`POST /api/auth/webview-launches` 回 201 launch URL且不設 cookie；GET URL 回 200 bridge且 DB 不變；bridge POST `/api/auth/session` 回 303、設定 8h cookie及 `Location: /`；後續 session GET 還原相同 User。

### Tests for User Story 1

- [X] T013 [US1] 先在既有 `server/src/features/auth/services/auth.service.spec.ts` 寫有效 RS256 JWT（固定 `alg/typ/iss/aud/sub/jti/iat/nbf/exp`、選填 `name`）驗章與設定載入單元測試，不新增獨立 token service spec
- [X] T014 [US1] 接續在 `server/src/features/auth/services/auth.service.spec.ts`、`server/src/features/auth/controllers/auth.controller.spec.ts` 寫 launch happy path、首次建 User／既有 User 白名單更新、GET bridge 零 DB 寫入及 POST activation 單元測試，不新增 session service spec
- [X] T015 [US1] 先新增完整 happy-path e2e 於 `server/test/webview-session.e2e-spec.ts`，並把檔名加入 `server/test/jest-e2e.json`；驗證 201 launch → 200 bridge（無 cookie／狀態變更）→ 303 session → 200 current session 的 headers、cookie、固定 Location 及 FGAPI profile 映射

### Implementation for User Story 1

- [X] T016 [P] [US1] 在既有 `server/src/features/auth/services/auth.service.ts` 實作私有 JWT 驗證流程，只接受 RS256 compact JWS，驗證固定 `typ=FT-ESIGN-LAUNCH+JWT`、issuer、單一 audience、`sub` 為 1–32 ASCII 英數、UUID v4 `jti`、必填 NumericDate、`exp-iat<=120` 與最多 ±30 秒 clock skew；`name` 只驗證 1–100 字元後丟棄，不新增獨立 token service
- [X] T017 [P] [US1] 在 `server/src/features/users/repositories/user.repository.ts` 增加 transaction manager 下的 `withDeleted + pessimistic_write` 員編查詢能力，供首次建立與既有 User 更新共用且不改變其他 repository 呼叫
- [X] T018 [US1] 在既有 `server/src/features/auth/services/auth.service.ts` 合併實作 happy path launch orchestration：verify JWT → claim `jti` row → FGAPI → transaction resolve User → 產生 code 摘要 → pending；只回固定 `WEBVIEW_LAUNCH_ORIGIN/api/auth/webview?code=...` 與 60 秒 expiry，不回 User、JWT 或 access token，不新增獨立 WebView login service
- [X] T019 [P] [US1] 在既有 `server/src/features/auth/controllers/auth.controller.ts` 以私有方法實作安全 bridge renderer，並測試於 `server/src/features/auth/controllers/auth.controller.spec.ts`：只接受 43 字元 base64url、HTML attribute 安全輸出、form action 固定 `/api/auth/session`、nonce script 自動提交、無 JavaScript 手動按鈕、無第三方資源；不新增 bridge helper
- [X] T020 [US1] 在既有 `server/src/features/auth/services/auth.service.ts` 實作 MySQL opaque session activation：POST 以 transaction 原子檢查 `status=pending AND launch_expires_at>now`、設定獨立 session-token 摘要、`active/activated_at/expires_at=activated_at+8h`，commit 後才回原始 cookie token；不得使用 JWT、Redis或新增 session service
- [X] T021 [US1] 在既有 `server/src/features/auth/controllers/auth.controller.ts` 合併實作所有 WebView auth endpoints：公開 `POST /auth/webview-launches` 回 201 JSON、唯讀 `GET /auth/webview?code=` 以 raw Fastify reply 回 200 HTML，以及公開 form `POST /auth/session`；成功以 raw reply 設 cookie、`Cache-Control: no-store`、`Referrer-Policy: no-referrer` 及 303 固定導向 `/`，避免 ResponseInterceptor 包裝 HTML／redirect，不新增獨立 WebView controller
- [X] T022 [US1] 在 `server/src/features/auth/services/auth.service.ts` 實作 cookie session 驗證，並將 `server/src/framework/guards/auth.guard.ts` 改為只注入 AuthService：對 cookie token做 SHA-256 後，以 MySQL 查 `active`、未撤銷、`expires_at>now` session，再查 User 存在、未 soft-delete且 active；把唯一 User ID 寫入 request 與 CLS，不解析本地 JWT
- [X] T023 [US1] 在 `server/src/features/auth/auth.module.ts` 只註冊既有 AuthController、AuthService、AuthGuard、AuthSessionRepository 與 FeastogetherModule，移除正式 auth runtime 對 JwtModule/RedisModule 與 session/verifier service 的依賴，且不得啟用既有 OAuth/dev-login routes
- [X] T024 [US1] 更新 `server/src/features/auth/services/auth.service.ts`、`server/src/features/auth/controllers/auth.controller.ts` 及其單元測試，使 `GET /api/auth/session` 只從 guard 已驗證身分回傳白名單 User 與 session `expiresAt`，忽略 body/query/header 的員編宣告

**Checkpoint**: US1 可從主平台 launch 完整進入電子簽，且 GET bridge 保持 safe method。

---

## Phase 4: User Story 2 - 拒絕偽造、過期與重放憑證（Priority: P2）

**Goal**: 所有偽造、錯誤用途、期限錯誤、JWT 重放與 code 重放都 fail closed，並且沒有額外可用 session。

**Independent Test**: 分別提交錯誤簽章／演算法／type／issuer／audience／claims／時間與重複 `jti`，以及過期、序列重放、並發重放 code；拒絕率 100%，最多一個合法 launch/session，GET bridge 重整永遠不消耗 code。

### Tests for User Story 2

- [X] T025 [US2] 擴充既有 `server/src/features/auth/services/auth.service.spec.ts`，覆蓋 algorithm confusion、未知 header key source、簽章竄改、錯誤 `typ/iss/aud`、重複 `empid` claim、缺／錯 `sub/jti/iat/nbf/exp`、超過 120 秒與 ±30 秒邊界，並斷言無 FGAPI/User 呼叫
- [X] T026 [US2] 先在 `server/src/features/auth/repositories/auth-session.repository.spec.ts` 與 `server/src/features/auth/services/auth.service.spec.ts` 寫相同 `jti` 及 code 的序列／並發競態測試，要求 unique／conditional update 最多一個成功且失敗後不釋放 credential
- [X] T027 [US2] 先新增 `server/test/security-webview-session.e2e-spec.ts` 並納入 `server/test/jest-e2e-security.json`，覆蓋偽造 JWT、URL/body/cookie 中的 JWT 不被接受、GET bridge 零寫入、code 過期／重放／並發、固定 redirect、無 token/PII error details

### Implementation for User Story 2

- [X] T028 [US2] 強化 `server/src/features/auth/services/auth.service.ts` 內的 JWT 驗章與 launch fail-closed mapping：完整驗章前不碰 FGAPI/MySQL User；驗章後先以 unique `source_jti_hash` claim，所有後續失敗標 `failed/failure_code` 且永不刪除或重開 `jti`
- [X] T029 [US2] 強化 `server/src/features/auth/services/auth.service.ts` 的 code 消耗交易，確保只以 digest 索引及 `pending + unexpired` 條件轉 active，duplicate-key／affected-row=0／回應遺失皆不恢復 code或產生第二個 token
- [X] T030 [P] [US2] 在 `server/src/features/auth/controllers/auth.controller.ts` 落實 GET bridge 無 repository/service 寫入、`Cache-Control: no-store`、`Referrer-Policy: no-referrer`、nonce CSP、同源 `form-action`、`base-uri 'none'`、無任意 redirect，並保留手動提交 fallback
- [X] T031 [P] [US2] 更新 `server/src/framework/interceptors/http-access-log.interceptor.ts` 與 `server/src/framework/interceptors/http-access-log.interceptor.spec.ts`：`/api/auth/webview` 不記 query／完整 URL，`POST /api/auth/webview-launches` 不記 Authorization，`POST /api/auth/session` 不記 body，且 event metadata 不含原始或摘要後的 `jti`、code、session token
- [X] T032 [P] [US2] 更新 `server/src/infrastructure/http-client/feastogether/feastogether.client.ts`、`server/src/infrastructure/http-client/feastogether/services/feastogether-hr.service.ts` 及其測試，讓 staff lookup failure log 只用無 query 的固定 operation 名，不記員編、完整 path、request/response 個資
- [X] T033 [US2] 在 `server/src/common/errors/app-error-code.ts` 與 `server/src/features/auth/controllers/auth.controller.ts` 統一 400/401/502/503 通用錯誤或安全 HTML；MySQL 不可用時 fail closed，不設定 code/cookie，不揭露驗章、員工存在性或 DB 細節

**Checkpoint**: US2 的所有 token、時間、用途及重放攻擊皆被拒絕，且敏感資料不進 URL 以外的允許位置或 log。

---

## Phase 5: User Story 3 - 驗證公司員工並安全維持 Session（Priority: P3）

**Goal**: 只接受 FGAPI 唯一精確合格員工，安全建立／更新 User，並提供固定期限 session、MySQL 登出撤銷及 Redis 故障容忍。

**Independent Test**: 模擬唯一精確、模糊、無結果、多筆精確、格式錯誤、timeout、並發首登、inactive／soft-deleted User；只有唯一合格員工能登入。有效 session 可讀、8 小時後失效、登出立即失效，Redis 完全不可用時流程仍成功。

### Tests for User Story 3

- [X] T034 [P] [US3] 先寫 FGAPI response 白名單與精確比對單元測試於 `server/src/features/auth/services/auth.service.spec.ts`、`server/src/infrastructure/http-client/feastogether/types/staff-lookup.dto.spec.ts`，覆蓋相似／零／多筆、1–32 ASCII 員編、必填 1–100 姓名、status `0|1`、status name `試用|正式`、nullable department code≤50/name≤150/title≤100及未知欄位忽略
- [X] T035 [US3] 擴充 `server/test/webview-session.e2e-spec.ts`，覆蓋首次／既有／同員編並發登入、保留 `users.department_id` 與非白名單欄位、inactive／soft-deleted拒絕、session 到期、MySQL 冪等登出、Redis 停止時完整 launch/session 流程仍成功

### Implementation for User Story 3

- [X] T036 [P] [US3] 在 `server/src/infrastructure/http-client/feastogether/types/staff-lookup.dto.ts` 與 `server/src/infrastructure/http-client/feastogether/services/feastogether-hr.service.ts` 對每筆 response 執行實際 class-validator 白名單驗證；只回傳正規化後與已驗證 `sub` 完全相同且恰好一筆的試用／正式員工，其他結果一律轉通用拒絕
- [X] T037 [US3] 完成 `server/src/features/auth/services/auth.service.ts` 的 User transaction：`withDeleted + FOR UPDATE`、inactive／soft-deleted fail closed、新 User `isActive=true`、既有 User只更新 FGAPI `name/personStatus/departmentName/titleName/lastLoginAt`、保留本地 `departmentId` 與其他欄位；`uq_users_empid` conflict 整筆最多重試一次
- [X] T038 [US3] 在 `server/src/features/auth/services/auth.service.ts` 實作固定 8 小時不滑動 session read/revoke：read 只接受 active、未撤銷、未過期 row；logout 以條件更新 `revoked_at/status=revoked`，無 cookie／過期／已撤銷皆回冪等完成
- [X] T039 [US3] 更新 `server/src/features/auth/services/auth.service.ts`、`server/src/features/auth/controllers/auth.controller.ts` 及其單元測試，正式提供 `DELETE /api/auth/session`（Public + OriginGuard）、先清 cookie再以 MySQL 撤銷，移除 `server/src/features/auth/services/auth-logout.service.ts` 與其 spec，且不保留 Redis `GETDEL`、本地 JWT解析或上游 logout 語意
- [X] T040 [US3] 在 `server/src/features/auth/services/auth.service.spec.ts` 與 `server/src/framework/guards/auth.guard.spec.ts` 驗證集中後的 DB session失效、到期、撤銷、User inactive/deleted、DB unavailable 及 Redis 不可用；DB unavailable 必須回 503 而不是偽裝為 401
- [X] T041 [US3] 更新仍保留但正式 runtime 不註冊的 `server/src/features/auth/services/dev-login.service.ts`、`server/src/features/auth/services/oauth-login.service.ts` 及其 specs與 `server/test/security-oauth-login.e2e-spec.ts`，改為只依賴 AuthService 的單一 MySQL session 能力，完成後移除 `server/src/features/auth/services/auth-session.service.ts`、`server/src/features/auth/services/auth-session-verifier.service.ts` 及其 specs；不得重建 Redis/JWT session service、不得啟用 OAuth/dev-login routes或形成平行 session 權威

**Checkpoint**: 三個 User Story 都可獨立驗收；MySQL 是唯一 session 權威，Redis 故障不影響 Spec 2。

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 收斂 contract、schema、文件與完整品質閘門。

- [X] T042 [P] 對照 `specs/002-webview-sso-session/contracts/openapi.yaml` 補齊 Swagger decorators、DTO response 型別及 route coverage 於 `server/src/features/auth/controllers/auth.controller.ts`、`server/test/api-coverage.e2e-spec.ts`
- [X] T043 [P] 更新 `server/docs/internal-electronic-signature-platform.md` 與 `server/docs/internal-electronic-signature-data-dictionary.md` 的最終 WebView launch、safe GET bridge、`auth_sessions` 欄位／索引、8 小時 session 及 Redis 非必要依賴說明，不擴充離職同步、OAuth token exchange 或清理排程
- [X] T044 執行 `specs/002-webview-sso-session/quickstart.md` 的 migration apply/revert/reapply、`pnpm -C server lint:check`、`pnpm -C server test`、`pnpm -C server build`、`pnpm -C server test:e2e`、`pnpm -C server test:e2e:security`，並確認 log 掃描中 JWT、Authorization、cookie、code/query/body、員編 query、姓名與 FGAPI response 出現次數為 0

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup（Phase 1）**: 無相依，可立即開始。
- **Foundational（Phase 2）**: 依賴 Setup；完成前阻擋所有 User Story。
- **US1（Phase 3）**: 依賴 Foundational，交付可操作的 WebView SSO happy path。
- **US2（Phase 4）**: 依賴 US1 的 endpoints/services，補齊偽造、重放、safe method 與資訊洩漏防護。
- **US3（Phase 5）**: 依賴 US1 session 主流程；可與 US2 的獨立安全測試／logging 工作部分平行，但最終 e2e 必須整合兩者。
- **Polish（Phase 6）**: 依賴欲交付的所有 User Story。

### User Story Dependencies

- **US1（P1）**: Foundational 後可開始，是 MVP 與 US2／US3 的共用登入骨架。
- **US2（P2）**: 需要 US1 的 token、launch、bridge 及 activation components 才能執行攻擊／並發驗收。
- **US3（P3）**: 需要 US1 的 launch/session happy path；FGAPI validation 與 User transaction 可和 US2 hardening 平行。

### Within Each User Story

- 先完成測試任務並確認測試在對應實作前失敗。
- Entity／migration／repository 先於 service；service 先於 controller/module wiring。
- JWT 驗章必須先於 `jti` claim；`jti` claim 先於 FGAPI/User；pending launch 先於 bridge POST activation。
- POST transaction commit 後才能送 session cookie；GET bridge 永遠不得執行寫入。
- 完成 story checkpoint 後才進入下一優先級。

### Parallel Opportunities

- T002 可與 T001 平行。
- T003、T005、T007、T011、T012 可先在不同檔案撰寫；T009 與 T010 在既有 AuthService 內依序進行。
- US1 的 T013、T014 在同一 spec 依序進行；T016、T017、T019 可在 contract 固定後平行。
- US2 的 T025、T026 在 AuthService spec 依序進行；T030、T031、T032 修改不同邊界可平行。
- US3 的 T034 可與 US2 security e2e 進行；T036 可在 AuthService 的 User/session 流程完成前獨立實作。
- Polish 的 T042、T043 可平行，T044 必須最後執行。

---

## Parallel Example: User Story 1

```text
Task T013 → T014: 依序在 auth.service.spec.ts 完成驗章及 launch happy-path 測試

完成共同測試契約後：
Task T017: User repository lock method
Task T019: Safe GET bridge renderer

Task T016: AuthService 私有 JWT verifier（與 T017、T019 不同檔案，可平行）
```

## Parallel Example: User Story 2

```text
Task T025 → T026: 依序在 auth.service.spec.ts 完成 JWT rejection 與 jti/code concurrency tests

完成 US1 endpoints 後：
Task T030: Bridge CSP 與 safe-method hardening
Task T031: HTTP access log 裁切
Task T032: FGAPI transport log 裁切
```

## Parallel Example: User Story 3

```text
Task T034: FGAPI mapping/validation tests
Task T036: FGAPI DTO runtime validation

Task T037: User resolve transaction（依 T017）
Task T038: Session read/revoke（依 T020）
```

---

## Implementation Strategy

### MVP First（US1）

1. 完成 Phase 1 Setup。
2. 完成 Phase 2 Foundational，包含可回滾 migration。
3. 完成 Phase 3 US1。
4. 停下並獨立驗證：201 launch → 200 safe bridge → 303 cookie → 200 current session。
5. US1 只作整合示範，不在 US2 security hardening 與 US3 FGAPI failure matrix 完成前視為 production-ready。

### Incremental Delivery

1. Setup + Foundational：建立唯一 MySQL session 權威。
2. US1：完成 WebView 無感登入 happy path。
3. US2：封閉偽造、重放、unsafe GET 及敏感資料洩漏面。
4. US3：完成 FGAPI fail-closed、User concurrency、到期／登出與 Redis outage 驗收。
5. Polish：同步正式文件並執行全部品質閘門。

## Notes

- `[P]` 只表示檔案與直接依賴允許平行，不代表可越過 phase gate。
- 主平台只需要 server-to-server launch POST 與開啟 GET URL；bridge 的 session POST 由電子簽同源頁面自動完成。
- 不實作 OAuth authorization-code/access-token exchange、JWE、Redis fallback、離職同步、MFA、外部簽署人或 session 清理排程。
- 原始 JWT、`jti`、launch code、session token、FGAPI key 與未遮罩個資不得進 DB、log、錯誤或非必要 payload。
- 每個任務或合理邏輯群組完成後提交，並保留使用者既有未相關變更。
