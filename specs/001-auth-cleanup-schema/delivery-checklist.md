# Spec 001 交付核對

日期：2026-10-12

## Client

- 無業務程式變更；既有 client server-memory mock store 仍是 mock，不宣稱已串接 NestJS/MySQL。
- root build/lint 已驗證 client 不受本次 server/schema 變更影響。

## Server

- FR-001～008、025～026、031：已移除 RBAC、permission、API registry、使用者管理、舊管理 audit 與 seed；全域 guard 對非 `@Public()` route 驗證有效 User session。
- FR-004～006：dev login 不再依賴 ADMIN；SSO/session/logout 原始能力由獨立 testing module 驗證，正式 AppModule 不註冊 AuthController/OAuthController。
- FR-007～008：`User` 是唯一 principal，不含 role、permission、password、description 或 `oauth_sub`。
- FR-027～029、032：schema 支援 user/email 兩種 signer；Email signer 不建立 User。外部簽署 session/guard 尚未實作，留待後續 spec。
- Repository 由 `MysqlModule` 統一提供；Service 掌握 transaction 邊界並明確傳入 `EntityManager`，Repository 不持有 `DataSource`。

## Migration / config

- FR-009～011、013～018、020～021、023～024、027～030：單一 baseline migration 建立 12 張 Stage 1 tables、固定名稱 FK/UNIQUE/index、兩項必要結構 CHECK、39 個日期／時間專屬單欄索引與窄化 evidence repositories。
- 舊 Auth/RBAC migrations 已刪除；MySQL options 明確列舉 12 entities 與單一 migration，`synchronize=false`、UTC。
- `schema.sql` 由 MySQL 8.4 `mysqldump` 重新產生，不含 Auth/RBAC tables。

## 驗證結果

- SC-001～004、006～008、010～013：通過。MySQL 8.4 已實跑 apply → constraints → revert → reapply；12 tables、39 time indexes、TypeORM schema drift 0。
- SC-005：通過 repository boundary 測試；signature/audit 不暴露 update/delete，verification 只提供窄化 revoke。這不是 DB trigger 或獨立 DB privilege。
- SC-009：schema 可同時保存 signed/rejected/pending 的實際結果且不把 rejected 當 signed；跨列 completed 條件仍屬後續 service/state-machine spec，未宣稱已完成。
- Unit：54 suites、344 tests 通過。
- E2E：一般 4 suites／15 tests、安全 3 suites／6 tests、schema 2 suites／2 tests 通過。
- Server 與 root workspace 的 build、lint、test 均通過；lint 尚有 13 個既有/測試型別 warning，0 error。

## 明確限制

- FR-012、019、022 的業務執行責任尚未實作：沒有 in-progress lock service、實際檔案 hash 流程或電子簽 API。
- 沒有 WebView token login、正式 SSO 入口、文件/簽署/通知/匯出/公開驗證 API，也沒有外部 Email signer 驗證 session。
- Schema、repository policy、dormant SSO 測試不等同於已完成登入或簽署功能。
