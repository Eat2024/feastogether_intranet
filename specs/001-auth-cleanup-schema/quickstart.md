# Quickstart：Spec 001 驗證

本文件描述實作完成後的驗證流程。Spec 001 的成功條件是清理後的 Auth 邊界與 schema baseline 可重現，不代表電子簽 API 或登入入口已完成。

## Prerequisites

- Node.js >= 20.19、pnpm 11
- MySQL 8.4 client/server（`schema:dump` 需要 `mysqldump`）
- Redis 7
- 從 `server/.env.test.example` 建立本機 `server/.env.test`
- `DB_MYSQL_DB` 必須以 `feastogether_intranet_test` 開頭；`REDIS_DB` 必須是 e2e 專用且非 0

不得把正式 secret、員工個資、文件或簽名測資寫入 env、fixture 或版本控制。

## 1. Install and static verification

```bash
pnpm install
pnpm -C server lint:check
pnpm -C server test
pnpm -C server build
```

預期結果：所有 retained SSO/session 測試通過，沒有 role／permission／user-management 相關 test suite 或 compile dependency。

## 2. Automated schema verification

```bash
pnpm -C server test:schema
```

測試 harness 必須自行使用 `feastogether_intranet_test*` 的獨立資料庫並完成清理，驗證：

1. 空庫套用 baseline。
2. 12 張 Stage 1 table（包含 `users`）的欄位、defaults、indexes、FK、unique、兩項必要結構 CHECK 與 collation 均符合 data model；39 個 `DATE`／`DATETIME(6)` 欄位各有專屬單欄 index，缺漏數為 0。
3. `auth_users`、roles、permissions、API registry、role mappings 與舊 management audit tables 均不存在。
4. 重複 user signer、大小寫不同的同一 Email、user/email 同時存在或皆不存在均被拒絕。
5. `watermark_enabled=0`、`allow_reject=1`。
6. revert 回乾淨狀態，再次 apply 成功且結構相同。
7. TypeORM schema log 無待產生 SQL，且 `information_schema.statistics` 驗證每個日期／時間 index 都以該欄為唯一索引欄位。

## 3. Manual migration drill

只對可拋棄、名稱符合 `feastogether_intranet_test*` 的資料庫執行。先在 `server/.env.test` 指定例如 `feastogether_intranet_test_spec001`。

```bash
pnpm -C server db:test:create

cd server
node --env-file=.env.test --conditions=development -r ts-node/register \
  ./node_modules/typeorm/cli.js migration:run \
  -d src/infrastructure/database/mysql/data-source.ts

node --env-file=.env.test --conditions=development -r ts-node/register \
  ./node_modules/typeorm/cli.js migration:revert \
  -d src/infrastructure/database/mysql/data-source.ts

node --env-file=.env.test --conditions=development -r ts-node/register \
  ./node_modules/typeorm/cli.js migration:run \
  -d src/infrastructure/database/mysql/data-source.ts
cd ..
```

MySQL DDL 會 auto-commit；若中途失敗且 migration 的 best-effort cleanup 也未完成，直接重建這個 disposable test DB，再重跑，不在半套 schema 上續跑。

## 4. Schema snapshot and drift

對本機可重建的 development DB 套用 baseline 後：

```bash
pnpm -C server schema:dump
git diff --check
git diff -- server/src/infrastructure/database/schema.sql
```

`schema.sql` 必須由 `mysqldump` 產生，不可手改。Review 應確認只含 12 張 Stage 1 tables（另有 TypeORM 自己的 migrations table，但 dump 會排除）、39 個日期／時間單欄 indexes，且不含舊 Auth/RBAC tables。

## 5. Runtime boundary checks

```bash
pnpm -C server test:e2e
pnpm -C server test:e2e:security
```

必要斷言：

- 空白 DB、無 RBAC seed 時 health check 可啟動。
- 所有未標 `@Public()` 的 endpoint 在沒有有效員工 session 時回 401；程式碼不存在 `RegisterApi`／API key metadata 引用。
- 正式 AppModule 已啟用精簡 AuthModule 的 global user-session guard，但未註冊 AuthController／OAuthController；SSO、dev login、logout/me、role 與 user-management routes 均回 404。
- 獨立 Auth testing module 的 OAuth start/callback、empid mapping、session、logout 仍通過。
- inactive／soft-deleted user 的既有 session 無法通過受保護 guard。
- DEVMOD login 不依賴 ADMIN role，且 production／staging 維持 fail-closed。

## 6. Full workspace verification

本規格不修改 client；server 驗證完成後仍執行 workspace gate，避免 root integration 漂移：

```bash
pnpm build
pnpm lint
pnpm test
```

## Expected limitations

- 不存在 WebView token login 或已啟用 SSO。
- 不存在文件、簽署、外部 Email 驗證、通知、匯出、檔案或公開驗證 API。
- Email 外部簽署人不建立 User，也尚未具備外部簽署 session；後續不可用裸 `@Public()` 簽署 endpoint 取代專用驗證 guard。
- DB CHECK 只保留 signer 身分 XOR 與 file owner 兩項結構性規則；其他欄位驗證、文件完成、拒絕後續簽、簽署 evidence 原子性與 in-progress lock 仍需後續 service/state-machine spec。
- Append-only 是正式 repository boundary，不是 DB trigger／獨立 DB privilege；任意 raw SQL 仍可能改資料。
