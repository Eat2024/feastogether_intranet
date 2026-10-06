# server/AGENTS.md

本文件適用於 `server/`，並繼承 `../AGENTS.md`。

## 技術與架構

- NestJS 11、Fastify、TypeScript、TypeORM 0.3、MySQL 8.4、Redis 7。
- HTTP server 入口為 `src/main.ts`；background worker 入口為 `src/worker.ts`，共用 `InfrastructureModule`。
- `src/features/`以 feature 分層；預設走 `Controller → Service → Repository`，DTO 用 `class-validator`，entity/DTO 由 mapper 轉換。
- `src/framework/` 放 guard/filter/interceptor/decorator 等橫切關注點；`src/infrastructure/` 放 DB、Redis、HTTP client 與 logging。
- `app.module.ts` 只組合 InfrastructureModule、FrameworkModule 與 FeatureModule；新 feature 在 `features/feature.module.ts` 註冊。
- queue processor、scheduler 與其 worker-only module 只在 `worker.module.ts` 註冊，避免 HTTP process 重複消費或排程。

## 必須遵守

- 每個 endpoint 都要明確標註 `@Public()` 或 `@RegisterApi(...)`；不可繞過全域 default-deny 授權。
- Controller 只處理 HTTP 邊界並回傳 DTO，不直接回傳 TypeORM entity，不重複包裝全域 interceptor 的 response envelope。
- 跨目錄 import 使用 `#app/*`，同 feature 近距離可用相對路徑；避免 `../../` 以上深層路徑。
- 業務 entity 繼承 `AuditableEntity`，DB 欄位用 snake_case、TS property 用 camelCase，並於 entity/欄位加繁體中文 comment。
- 更新需稽核 entity 時使用 `repository.save(entity)`；刪除業務資料預設使用 soft delete。
- DB 寫入以 UTC 為準；台北時間僅在 API/UI 邊界轉換，使用現有 date-time helper。
- schema 由 migration 管理，不開啟 `synchronize`。變更 schema 必須同步 entity、migration、測試與 `schema.sql`。
- 錯誤使用 `AppException` 與穩定的 `AppErrorCode`；log 使用既有結構化 logger，不記錄 secret、token、cookie 或簽名資料。
- 測試 DB 名稱必須以 `feastogether_intranet_test` 開頭，不得降低此 fail-closed 保護。

## 驗證

```bash
pnpm lint:check
pnpm test
pnpm build
pnpm worker:dev
pnpm test:e2e          # 需要 MySQL/Redis 與 .env.test
pnpm test:e2e:security # 需要 MySQL/Redis 與 .env.test
```

新業務規則先寫可獨立驗證的 service/helper 測試；涉及 HTTP、auth、guard 或 DB 整合時再補 e2e。
