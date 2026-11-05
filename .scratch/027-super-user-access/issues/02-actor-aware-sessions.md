# 02: 擴充可辨識操作者的共用會話，保持員工相容

**What to build:** 先將既有會話擴充為可辨識 employee／super_user 的共用生命週期，使後續三種入口能原子替換身分；完成後以既有員工回歸與隔離整合測試證明相容性。

**Status:** resolved

**Blocked by:** [01-super-user-credential-config](01-super-user-credential-config.md)

**Source:** [Spec](../../../specs/027-super-user-access/spec.md)、[Plan](../../../specs/027-super-user-access/plan.md)、[Tasks](../../../specs/027-super-user-access/tasks.md)、[資料模型](../../../specs/027-super-user-access/data-model.md)、[API 行為](../../../specs/027-super-user-access/contracts/api-behavior.md)、[維運契約](../../../specs/027-super-user-access/contracts/operations.md)、[驗收指南](../../../specs/027-super-user-access/quickstart.md)。

**Scope:** T001、T002、T004、T006、T007、T008、T009、T010、T012、T013、T014、T053。

**切片說明:** 這是 `to-tickets` 允許先完成的 prefactoring。它同時涵蓋持久約束、repository、會話交易與驗證；不把單純建表當成功能交付，也不提前開放 Super user 業務權限。新登入路徑與前端尚未公開。

## Acceptance Criteria

- [x] 核對現有變更與測試入口，將新增 security/schema 測試納入實際執行範圍；所有 DB 測試只用受保護的隔離測試庫。
- [x] 增量擴充既有會話並建立入口 singleton／append-only 安全事件；落實資料模型全部型別、NULL、CHECK、FK、unique 與索引約束，保留既有員工、文件關聯及歷史資料。
- [x] employee 保留原 user 回應；super_user 無員工 FK、無偽造員編，僅 employee 設員工 request／CLS context。查會話使用可接受非員工的關聯方式。
- [x] 會話固定八小時不滑動；過期、撤銷、員工停用或維護版本失配均拒絕。每次驗維護會話查 DB 有效版本，不使用權限／版本快取。
- [x] 撤舊、簽新、replacement 關聯與成功安全事件同交易；固定鎖序，失敗 rollback 保留舊會話，已被替換舊 token 再使用回 409。cookie 原值只在 commit 後交回呼叫端。
- [x] 安全事件僅白名單種類與欄位，credential 拒絕另短交易；不保存帳密、入口、token、IP、UA、body 或文件資料，不恢復簽署事件鏈。
- [x] 實際驗證空庫與既有資料 migration、apply/down/reapply、約束與 employee 回填；有維護事件或維護 session 時拒絕破壞性 down。以專案工具產出 schema 快照。
- [x] 共用會話的行為測試及既有員工回歸通過；本張不要求尚未存在的隱藏登入頁或週排程。

## Comments & Implementation Results

### 變更摘要

- Schema：migration `1793836802000-SuperUserAccess` 以單一 ALTER 為 `auth_sessions` 加 `actor_kind`（預設 employee 回填）、`credential_generation`、`replacement_session_id`（self FK RESTRICT、unique）、`(actor_kind,credential_generation,status)` 索引與 `chk_auth_sessions_actor`／`chk_auth_sessions_active_session`；新建 `super_user_access`（id=1 singleton）與 append-only `auth_security_events`。down 在有安全事件、入口列或 Super user 會話時拒絕。entity、`mysql.options.ts` 與 `schema.sql` 同步。
- `auth.types.ts`：`Actor = {kind:'employee',userId} | {kind:'super_user'}`、`AuthenticatedSession`、`SessionTarget`、`IssuedSession`。
- Repository：`AuthSessionRepository.findActive` 改 LEFT JOIN（員工狀態交由 service 判斷）、`createActive` 收欄位物件、新增 `findByTokenHashForUpdate`／`revokeById`；新增 `SuperUserAccessRepository`（find／findForUpdate）與 `AuthSecurityEventRepository`（append、`list` 預設 20 最大 100、beforeId 倒序），皆在 `MysqlModule` 註冊。
- `AuthSecurityEventService`：`append` 與呼叫端同交易；`recordRejection` 另開短交易，失敗只記 `auth.security_event_unavailable` 與事件種類並回 503。欄位只有白名單，無帳號、密碼、IP、UA、body、入口、token、fingerprint 或文件資料。
- `SessionService`：`authenticate`（員工停用／soft-deleted 拒絕；Super user 每次讀 DB singleton，fingerprint 不符或缺列 503，generation 不符 null）、`replace`（鎖序 singleton → 舊會話 → 新會話；舊列已有 replacement 回 409；撤舊、連結 replacement、`session.replaced`／`login.succeeded` 同交易；commit 後才回 token；固定八小時）、`revoke`。兩個交易用 READ COMMITTED。
- 員工相容：`AuthService.verifySessionToken` 委派 `SessionService.authenticate`，只把 employee 交給既有 guard；`getMe`／login／OAuth／dev-login 回應多一個 `actor` 欄位，其餘不變。`AuthModule` 註冊 `SessionService`、`SuperUserConfigService`、`AuthSecurityEventService`；`setup-e2e.ts` 以合成帳號與預先算好的 scrypt hash 無條件覆寫 `SUPER_USER_*`。
- 測試：`super-user-schema.e2e-spec.ts`（7）、`security-actor-session.e2e-spec.ts`（7）、`session.service.spec.ts`（12）、`auth-security-event.service.spec.ts`（4）；更新既有 schema／entity／options／AuthService／oauth security 測試以符合新 schema 與建構子；jest-schema 與 jest-e2e-security 白名單納入本張及後續三個 security 測試名。

### 驗證（指令與實際結果）

- `pnpm -C server lint:check`：0 errors、276 warnings；新檔 0 warning，修改檔剩餘 warning 均在未改動的既有行。
- `pnpm -C server test`：122 suites／1238 tests 通過。
- `pnpm -C server build`：成功。
- `pnpm -C server test:schema`：6 suites／39 tests 通過；結束後只剩 `feastogether_intranet_test_a`，無 `_<hex>` 殘留庫。
- `pnpm -C server test:e2e:security`：15 suites／91 tests 通過。
- `pnpm -C server test:e2e`：50/51 suites 執行，542 passed、1 skipped、1 failed。失敗的是 `api-coverage`「GET /api/esign/documents/1/history 已註冊且受 employee session 保護」（期望 401、實得 404），單獨重跑結果相同。原因在本張之前：基底 commit `9344734` 已移除該路由，但 `specs/003-core-esign-flow/contracts/openapi.yaml` 仍列出它；本張沒有改 esign 或該契約，所以沒有修。員工登入回歸 `webview-session`、`oauth-login`、`password-login` 單獨跑 3 suites／36 tests 通過。結束後測試庫沒有 Super user 會話、入口列或事件殘留。
- READ COMMITTED 的必要性：把 `SessionService` 暫改回預設 REPEATABLE READ，`security-actor-session` 的「兩個帶不存在 cookie 的登入」案例 2/2 次 deadlock 失敗；改回後通過。
- 開發庫 `feastogether_intranet_027a`：空庫 apply 21 支 → revert 本支 → 帶合成員工 session reapply（回填 employee）→ 有合成 Super user 會話時 revert 被拒 → 刪除合成列；`pnpm -C server schema:dump` 更新快照。詳見 quickstart「027-02」小節。

### 未驗證／限制

- 完整 `test:e2e` 有 1 筆既有失敗（見上），需另開工作同步 003 openapi 契約，或還原 history 路由的驗收定義。
- client 與 root lint／build 未跑（本張未改 client）。兩實例、iframe、代理遮罩尚無對應功能。
- 合併後任何啟動完整 AppModule 的環境都必須設 `SUPER_USER_ACCOUNT`／`SUPER_USER_PASSWORD_HASH`，否則啟動失敗（01 的設計）。本 worktree 的 `server/.env`、`.env.example`、docker-compose／UAT 都還沒有這兩個變數；`.env.example` 屬 T052。
- `schema.sql` 的 diff 除 027 變更外，另把 `users`、`esign_export_jobs` 欄位順序與 `esign_initiation_jobs` 格式對齊實際 migration 結果（結構不變）。
- 結果碼白名單（`succeeded`、`credentials_invalid`、`replaced`、`logout`）是本張依 data-model「白名單結果碼」自訂，規格沒有列舉；DB 端未加 CHECK，只由 TypeScript 型別限制。

### 給後續 ticket 的備註

- 03 REPL：用 `SuperUserAccessRepository.findForUpdate` 作為入口／啟用交易的第一把鎖；初始化／輪換／啟用的條件寫入（T015／T039／T047）尚未實作。`AuthSecurityEventRepository.list` 已檢查 limit 1～100，REPL 不需再驗一次。REPL 事件 actor 用 `operator`。
- 04 隱藏登入：用 `SessionService.replace(cookieToken, {kind:'super_user'})` 簽發，commit 後拿到 `{token, expiresAt}` 才 Set-Cookie；帳密錯誤呼叫 `AuthSecurityEventService.recordRejection({type:'login.rejected', actor:{kind:'anonymous'}, outcome:'credentials_invalid'})`。`actor.context.ts`、`request.actor`、`AllowSuperUser` 與 Super user session view（`{actor:{kind:'super_user',displayName:'Super user'},user:null}`）未建立，留給 T022；目前 guard 只接受 `verifySessionToken` 回傳的員工，Super user 會話打員工路由得 401，fingerprint 不符時 503。
- 05 三入口替換：OAuth／WebView／logout 仍走 `AuthService` 舊路徑（OAuth 仍寫 `source:'webview'`，不寫安全事件）。改走 `SessionService` 後會寫入參照 `auth_sessions`／`users` 的事件（FK RESTRICT），既有 e2e cleanup 的 `DELETE FROM auth_sessions／users` 必須先刪 `auth_security_events`，再把 `replacement_session_id` 設 NULL。
