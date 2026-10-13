# Implementation Plan: WebView SSO 與員工 Session

**Branch**: `[002-webview-sso-session]` | **Date**: 2026-10-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-webview-sso-session/spec.md`

## Summary

在現有 NestJS `auth` feature 正式啟用兩段式 WebView launch：主平台後端以 HTTPS POST `Authorization: Bearer` 送入最長 2 分鐘、一次性的 RS256 JWT；Server 固定驗證簽章、`typ`、`iss`、`aud`、`sub = empid`、`jti` 與時間 claims，以 MySQL 唯一約束原子防重放，再以 `sub` 精確查詢 FGAPI。唯一合格結果會建立或更新 `users`，並建立最長 60 秒的待啟動紀錄，回傳含一次性隨機 code 的 `launchUrl`。主平台以該 GET URL 開啟 WebView；GET 只回傳 no-store 的同源自動提交 bridge，不做寫入。Bridge 立即 POST code 至 session resource，電子簽才原子消耗 code、設定 8 小時不滑動的不透明 session cookie，再以 `303` 導向固定首頁。

本版新增一張 `auth_sessions` 表，統一保存 `jti`／launch code／session token 的不可逆摘要與狀態；MySQL 是認證唯一權威來源，Redis 故障不影響此流程。JWT 是 JWS 簽章資料而非加密資料，不交換 access token，也不需要電子簽私鑰。JWT 選填 `name` 只做介接資訊，不是第二認證因素，不參與本地 User 決策或寫入。

## Technical Context

**Language/Version**: TypeScript 5.7，Node.js >= 20.19.0

**Primary Dependencies**: NestJS 11、Fastify 5、`@fastify/formbody` 8、`@nestjs/jwt` 11、TypeORM 0.3、MySQL 8.4、Axios / `@nestjs/axios`、class-validator

**Storage**: 既有 MySQL `users` 表；新增 MySQL `auth_sessions` 表保存 launch 與 session 狀態及所有憑證摘要。本規格需要 entity、migration 與 `schema.sql` 更新。

**Testing**: Jest 30 單元測試；Nest/Fastify e2e；需 MySQL 的 `test:e2e` 與 `test:e2e:security`，另驗證 Redis 完全不可用時認證流程仍正常

**Target Platform**: Linux 容器中的 NestJS HTTP server，由反向代理提供 HTTPS，消費端為公司主平台開啟的 WebView

**Project Type**: pnpm workspace 內的 Web API feature；Spec 2 只改 server 與介接文件

**Performance Goals**: FGAPI 正常時 95% launch 建立於 3 秒內完成；WebView bridge 載入、code POST 消耗與導向於 1 秒內完成；JWT 無效時不發出 FGAPI 或 User 查詢；以摘要與 `empid` 唯一索引定位，不隨員工或 session 數量線性掃描

**Constraints**: RS256 固定單一 issuer/audience/type/公鑰；launch JWT 最長 120 秒且時鐘容忍最多 30 秒；`jti` 與 launch code 皆只能使用一次；code 最長 60 秒；session 最長 8 小時且不滑動；URL 只允許無身分內容的短效 code，query 不進 log；FGAPI 不可用時 fail closed

**Scale/Scope**: 單一主平台、單一電子簽服務、內部員工登入；1 個 launch 建立 endpoint、1 個唯讀 WebView GET bridge、1 個 session REST resource與 1 條 FGAPI 查詢，無離職同步、MFA、外部簽署人或多 issuer

## Constitution Check

_GATE: Phase 0 前與 Phase 1 後皆已檢查，全數通過。_

- **KISS / YAGNI**: PASS。只新增一張同時承載 launch 與 session lifecycle 的表；不建 OAuth server、access token、provider framework、JWKS discovery、Redis fallback、排程、部門同步、MFA 或離職流程。
- **Server 權威**: PASS。JWT 只先驗證後使用，FGAPI 確認員工，User/session 都由 server 建立；client 無法覆寫 principal。
- **最小權限與資料最小化**: PASS。JWT 只要求必要 claims，選填姓名不落庫；本地 cookie HttpOnly/Secure；DB 只保存 JWT `jti`、launch code 與 session token 的摘要；log 不含原始憑證、query 或 FGAPI 員編。
- **清楚邊界**: PASS。`POST /api/auth/webview-launches` 建立 launch、`GET /api/auth/webview` 只回傳 bridge、不寫入，`POST/GET/DELETE /api/auth/session` 建立、讀取與撤銷 session；controller 只處理 HTTP 邊界，驗證、FGAPI 與交易在 service/repository。
- **與風險相稱的驗證**: PASS。規劃單元、HTTP e2e 與 security e2e，覆蓋簽章、claim、過期、重放、並發、FGAPI 失敗、cookie、登出與 log 裁切。
- **技術與 workflow 約束**: PASS。沿用現有技術與 pnpm；新增 Fastify 官方 `@fastify/formbody` 是解析 bridge 標準 HTML form POST、保留無 JavaScript fallback 的最小必要 dependency。新設定僅為已核准的驗章、固定 launch origin 與 Origin 防護所必需。

### Post-design re-check

Phase 1 仍無違反。主平台介接、HTTP API、MySQL launch/session lifecycle 與 User 已分開定義；合約沒有擴大為 OAuth/OIDC、access token、多重認證、多金鑰輪替或組織主檔同步。

## Project Structure

### Documentation (this feature)

```text
specs/002-webview-sso-session/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── main-platform-jwt.md
│   └── openapi.yaml
└── tasks.md              # 由 speckit-tasks 後續產生
```

### Source Code (repository root)

```text
server/
├── .env.example
├── package.json
├── src/
│   ├── bootstrap/app.bootstrap.ts
│   ├── common/errors/app-error-code.ts
│   ├── features/auth/
│   │   ├── auth.constants.ts
│   │   ├── auth.module.ts
│   │   ├── controllers/auth.controller.ts
│   │   ├── helpers/auth-cookie.ts
│   │   ├── entities/auth-session.entity.ts
│   │   ├── repositories/auth-session.repository.ts
│   │   └── services/auth.service.ts
│   ├── features/users/repositories/user.repository.ts
│   ├── framework/interceptors/http-access-log.interceptor.ts
│   └── infrastructure/
│       ├── database/
│       │   ├── migrations/<timestamp>-create-auth-sessions.ts
│       │   ├── schema.sql
│       │   └── mysql/
│       │       ├── mysql.module.ts
│       │       └── mysql.options.ts
│       └── http-client/feastogether/
│           ├── feastogether.client.ts
│           ├── services/feastogether-hr.service.ts
│           └── types/staff-lookup.dto.ts
└── test/
    ├── webview-session.e2e-spec.ts
    └── security-webview-session.e2e-spec.ts
```

**Structure Decision**: 只修改 `server` 的既有 auth/users/infrastructure 邊界並新增必要 migration。所有正式 auth HTTP endpoints 與 bridge rendering 收斂在既有 `auth.controller.ts`；設定驗證、credential 產生／摘要、JWT 驗章、launch、FGAPI/User resolve、session 建立／驗證／撤銷全部收斂在既有 `auth.service.ts`。不另建 WebView controller、credential／bridge helper 或任何單一用途 auth service；既有共用 cookie helper 繼續沿用，既有 `auth-session.service.ts`、`auth-session-verifier.service.ts`、`auth-logout.service.ts` 則於遷移後移除。資料庫 query 仍保留在 `auth-session.repository.ts`，避免 service 直接耦合 TypeORM。亦不為 Spec 2 新建 package、worker processor 或 client 登入狀態。原有 dormant OAuth/dev-login routes 不啟用，也不得用於 WebView 繞過驗證。

## Complexity Tracking

無 constitution violation，不需複雜度例外。
