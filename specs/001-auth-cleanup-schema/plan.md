# Implementation Plan: 舊授權清理與電子簽資料基礎

**Branch**: `[001-auth-cleanup-schema]` | **Date**: 2026-10-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-auth-cleanup-schema/spec.md`

## Summary

移除由驗收系統帶入的 RBAC、API permission registry、使用者管理與其專用稽核，將既有 Auth 收斂為「員工身分、Redis session、登出，以及保留但不啟用的 SSO 串接」。同時以一個可重建的 MySQL 8.4 baseline migration 建立資料字典所列 12 張 Stage 1 資料表、對應 TypeORM entities、必要完整性約束與索引，並由真實 MySQL migration 測試及重新產生的 `schema.sql` 證明 entity、migration 與快照一致。本規格不新增或啟用登入流程，也不新增電子簽業務 API。

## Technical Context

**Language/Version**: TypeScript 5.7.3；Node.js >= 20.19.0
**Primary Dependencies**: NestJS 11、Fastify 5、TypeORM 0.3.28、mysql2、Redis 7、`@nestjs/jwt`、openid-client 6
**Storage**: MySQL 8.4（12 張 Stage 1 關聯資料表）、Redis 7（既有 session／SSO 暫存）；本規格不串 object storage
**Testing**: Jest 30 單元測試、Nest e2e、MySQL migration integration、TypeORM schema drift 檢查、`mysqldump` schema snapshot
**Target Platform**: Linux container／server，HTTP server 與獨立 worker entrypoint
**Project Type**: pnpm workspace web application（Next.js client + NestJS server）；本規格主要修改 server 與規格文件
**Performance Goals**: 本規格無 API throughput 或 latency SLO；migration 驗收以空白 DB 完整套用、撤回及重套為準
**Constraints**: `synchronize=false`；所有 DB 可重建；MySQL DDL 非原子交易；SSO 原始碼需保留但不得啟用；不得保留 RBAC 執行期依賴；證據與稽核資料不可由一般 repository 更新或刪除；所有時間以 UTC `DATETIME(6)` 保存；每個 `DATE`／`DATETIME(6)` 欄位皆有專屬單欄索引
**Scale/Scope**: 12 張資料表、1 個乾淨 baseline migration；員工／部門屬組織主檔，文件、簽署、audit 與 file metadata 預期長期累積，索引需支援未來百萬級資料但本規格不做容量承諾

## Constitution Check

_GATE: Phase 0 前檢查，並在 Phase 1 設計後重查。_

| 原則                        | Phase 0 檢查     | Phase 1 重查       | 設計落點                                                                                                                       |
| --------------------------- | ---------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| I. KISS／YAGNI              | 有一項已核准例外 | 通過（例外已記錄） | 使用者明確要求一次建立 12 張表；不新增 API、provider framework、登入方式或額外版本表。例外與移除成本記於 Complexity Tracking。 |
| II. Server 權威與證據完整性 | 通過             | 通過               | Hash 僅保存 server 對實際內容計算的值；signature／audit 使用 insert/query-only repository；不把 DDL 誤稱為完整流程保證。       |
| III. 最小權限與資料最小化   | 通過             | 通過               | 刪除 role／permission／使用者管理；file table 僅存 private object metadata；外部簽署人只保存姓名與正規化 Email。               |
| IV. 清楚系統邊界            | 通過             | 通過               | entities 與 repositories 放在 server 對應 feature；client 不 import server；本規格沒有新 HTTP contract。                       |
| V. 風險相稱驗證             | 通過             | 通過               | 保留 SSO/session 安全測試；新增 MySQL apply → revert → reapply、約束及 schema drift 驗證。                                     |
| Engineering constraints     | 通過             | 通過               | 沿用 pnpm、NestJS、TypeORM、MySQL、Redis；migration 管 schema；文件與註解使用繁體中文。                                        |

## Technical Decisions

### 1. Auth 清理與保留邊界

- 刪除 role、permission、role mapping、API registry／permission mapping、authorization cache、RBAC seed、舊使用者管理 controller/service/repository/DTO、通用管理 audit 與其測試。
- 刪除 `@RegisterApi` 與 API key metadata。全域 `AuthGuard` 對所有未標 `@Public()` 的 endpoint 預設驗證員工 session，並在每個 request 重新確認員工存在、未軟刪且為 active；新增 route 即使漏加 decorator 也仍受保護。`@Public()` 僅用於建立 session 前或基礎設施確實需要的入口，且入口仍須自行完成 launch code、OAuth state 等適用驗證。
- 保留 OAuth client、transaction、callback/identity mapping、session issue/verify/revoke、logout、cookie、origin/rate-limit 與開發登入隔離能力。正式 FeatureModule 只註冊精簡後 AuthModule 所提供的全域員工 session guard，不註冊 AuthController 或 OAuthController，因此會啟用「非 Public API 預設需 session」的防護，但不啟用 SSO、dev login、logout/me route 或任何新登入入口。
- 將 `AuthUser` 改為 `User`，以 `users.id` 作 JWT `sub` 與 Redis session 主體。`auth/me` 若留作可測資產，只回員工最小身分資料，不再回角色、permission 或導覽授權。
- SSO 每次以已驗證 UserInfo 的上游 `employee_number` claim 對應唯一 `users.empid`；移除無識別用途的 `oauth_sub` 持久化與舊 `department_code` session 欄位，不另建 identity-binding table。
- Email 外部簽署人不走員工 `AuthGuard`，也不建立 User。後續規格須以 signer/document scope 的獨立外部 session 與專用 guard 驗證；Spec 1 只建立 `signer_type=email` 資料形狀，不建立邀請、OTP、launch code exchange 或簽署 endpoint。

### 2. Clean baseline migration

- 因所有環境均可重建，直接以新的單一 baseline 取代既有 Auth/RBAC migrations；不建立只為舊 DB drop／rename 的相容 migration。已套用舊 timestamp 的 DB 必須 reset，不能期待改寫後 migration 自動重跑。
- `up()` 不用 `IF NOT EXISTS` 掩蓋漂移，使用固定 `fk_`、`uq_`、`idx_` 名稱；僅兩個必要結構 CHECK 使用固定 `chk_` 名稱。建立失敗時只對本次已建立的表做 best-effort 反向清理並明確報錯。MySQL DDL 會 auto-commit，因此不宣稱整批 DDL 可由交易原子回滾。
- 建立順序：`hr_departments`（先不加 user actor FK）→ `users` → 回補 department actor FK → documents → fields → signers → signatures → audit → verification → notification batches → notification logs → export jobs → file objects；`down()` 先移除循環 FK 再反向 drop。
- 所有 FK 採 RESTRICT／NO ACTION，不 cascade 歷史或證據資料；TypeORM relation 不開 cascade/eager。

### 3. Entity 與稽核基底

- `BaseEntity` 的 `created_at` 修正為 `DATETIME(6)`；`AuditableEntity` 保留共通的 `updated_at`／`deleted_at`。資料字典要求操作人的主體再繼承 user-auditable subclass，將舊 `created_by`／`updated_by` VARCHAR 改為 nullable BIGINT `created_by_user_id`／`updated_by_user_id`，AuditSubscriber 寫入員工 ID。
- 為避免偷偷替資料字典加欄位，只有字典明列 actor 欄位的 `hr_departments`、`esign_document_fields`、`esign_signers` 使用 user-auditable subclass；`users`、`esign_documents` 使用 `AuditableEntity`，operational tables 則按字典明列的 timestamps 建模。
- `esign_signature_records`、`esign_audit_events` 只繼承 `BaseEntity`，不含 update/delete/soft-delete；`esign_verification_records` 只提供窄化的 `revoke()`；其他 operational records 依資料字典提供所需狀態更新，不暴露通用刪除介面。

### 4. 關聯完整性與索引

- `esign_signers` 使用 DB CHECK 保證 user/email 身分 XOR，並以 `UNIQUE(document_id, user_id)` 與 `UNIQUE(document_id, email)` 分別防重。外部 Email 在 server trim 並轉小寫後寫入，欄位採不分大小寫 collation；草稿移除後重新加入同一人時復原原列，不用 soft-delete 繞過唯一鍵。
- DB CHECK 只保留 signer 身分類型 XOR 與 file object 至少一個 owner。狀態／時間、頁碼、百分比座標、非負計數、簽署期限與跨列狀態機皆由後續 service transaction 驗證，不把易變業務規則堆在 entity，也不以 schema 已存在冒充功能完成。
- UUID、SHA-256、authentication event ID 採 ASCII binary；`object_key` 採 case-sensitive collation；DECIMAL 在 TypeScript 用字串或既有 Decimal transformer，不經 JS 浮點運算。
- 每個 `DATE`／`DATETIME(6)` 欄位都建立專屬單欄索引，即使該欄位已出現在複合索引中；複合索引另以已知查詢為準，包含建立者文件列表、我的電子簽、文件欄位順序、文件 audit timeline、文件簽署人完成檢查，以及通知／匯出工作狀態。非時間欄位仍避免同一 left prefix 的冗餘索引。

### 5. 驗證與文件一致性

- 新增 entity metadata unit tests 與真實 MySQL migration e2e；測試 DB 名必須符合 `feastogether_intranet_test*` 並使用獨立 suffix。
- e2e 驗證空庫 apply → 12 表且無 RBAC 舊表 → defaults/FK/unique/兩項結構 CHECK → revert → reapply；另以獨立 Auth testing module 驗證 dormant SSO 核心，而正式 AppModule 對 OAuth／role／user-management 路由仍為 404。
- 由套用 migration 的 DB 執行 TypeORM schema log，要求 entity/migration 無 SQL diff；再以 `schema:dump` 重新產生 `server/src/infrastructure/database/schema.sql`，不得手改。
- 規劃階段已清除 total spec 中殘留的 `role_id`、本地備註與通用 RBAC 描述；實作時持續以 Spec 1 與本 data model 檢查資料字典、ER model、entities、migration 與 schema snapshot 一致。

## Project Structure

### Documentation (this feature)

```text
specs/001-auth-cleanup-schema/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── README.md
└── tasks.md                 # 由後續 $speckit-tasks 產生
```

### Source Code (repository root)

```text
server/
├── docs/
│   ├── internal-electronic-signature-data-dictionary.md
│   ├── internal-electronic-signature-er-model.md
│   └── internal-electronic-signature-platform.md
├── src/
│   ├── features/
│   │   ├── auth/            # 保留 SSO/session，移除 RBAC 與使用者管理
│   │   ├── users/
│   │   │   ├── entities/
│   │   │   └── repositories/
│   │   └── esign/
│   │       ├── entities/
│   │       └── repositories/
│   ├── framework/
│   │   ├── decorators/public.decorator.ts
│   │   └── guards/auth.guard.ts       # 非 Public 路由預設驗員工 session
│   └── infrastructure/database/
│       ├── migrations/
│       ├── mysql/mysql.options.ts
│       ├── schema.sql
│       ├── auditable.entity.ts
│       └── audit.subscriber.ts
└── test/
    ├── schema-migration.e2e-spec.ts
    └── retained auth/session e2e specs
```

**Structure Decision**: 不修改 client，也不新增電子簽 controller/module/API。使用者主體放入 `features/users`；12 張表中其餘電子簽資料放在單一 `features/esign` 邊界，現階段包含 entities、窄化 repositories，以及承接 Email 正規化業務規則的最小 signer service；避免為尚未實作的文件、通知、驗證與匯出流程預建其他 service/controller 抽象。共用 DB options、migration、audit subscriber 與 schema snapshot留在 infrastructure。

## Complexity Tracking

| Violation                              | Why Needed                                                                                             | Simpler Alternative Rejected Because                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 一次建立 12 張表，其中部分尚無寫入流程 | 使用者明確選擇 schema-first；Stage 1 的文件、簽署證據、audit、驗證、通知與匯出共同決定外鍵及不可變邊界 | 只建員工／文件最小表會讓後續 specs 反覆改核心 FK、migration 與證據關係，無法先驗證完整基準。若範圍縮減，移除成本是一支可回滾 migration，加上同步刪除 entities、索引、字典與 ER model。 |
| 每個日期／時間欄位都建立專屬單欄索引   | 使用者明確要求所有時間欄位可直接作為索引查詢起點，且 SC-012 要求缺漏數為 0                             | 僅依已知查詢建立複合索引可減少寫入與儲存成本，但無法滿足每個時間欄位皆有 index 的明確需求；若日後取消，移除成本為 drop 對應 indexes 並同步 entity、migration、快照與文件。             |
