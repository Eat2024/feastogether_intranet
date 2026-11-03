# Implementation Plan: Portal 直連取代饗賓人人資查詢

**Branch**: `feat/024-portal-hr-source`（基於 `dev` `1ab6b99`） | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/024-portal-hr-source/spec.md`

## Summary

在 `server/src/infrastructure/portal/` 新增一個 Portal 唯讀連線（mysql2 pool，延遲到第一次查詢才連線），由三個功能共用：

- **選人部門樹**：改查 Portal，照 fgapi 的規則組樹；回應與快取契約不變。
- **登入時的員工資料**：三個登入入口改查 Portal；資格規則與錯誤碼不變。
- **員工主檔匯入**：023 的匯入改由 worker 每天 04:00（台北時間）自動執行。
  - 不合法的資料列個別略過。
  - Portal 明確標為非在職的人會被停用，但停用人數有門檻。
  - 不留任何檔案，也不提供回復功能。
  - 手動 CLI 保留給臨時同步使用。

最後移除饗賓人 `hr/org_chart`、`hr/staff_lookup`、`hr/staff_emails` 的呼叫程式。client 不需要修改。

## Technical Context

**Language/Version**：TypeScript 5.7、Node >=24.22.1；文件與錯誤訊息使用繁體中文。

**Primary Dependencies**：既有的 NestJS 11、TypeORM 0.3、mysql2 ^3.18.2、BullMQ ^5.81.5／@nestjs/bullmq ^11.0.5、class-validator。不新增 dependency。

**Storage**：
- 主 DB MySQL 8.4：只寫 `users`，不改 schema。
- Portal MySQL 8.0.31：唯讀。
- Redis：既有的部門樹快取與 BullMQ。

**Testing**：
- Jest 單元測試：組樹、匯入規則、員工資料查詢、scheduler、SQL 欄位白名單。
- e2e：真 MySQL／Redis，加上 `test/synthetic-portal.helper.ts` 建立的合成 Portal 資料庫。

**Target Platform**：既有 Linux Docker，HTTP 與 worker 分開；UAT 位於 `intranet-uat_default` 網路，已實測可以連到 Portal。

**Project Type**：pnpm workspace 的 web service（`server/`）；`client/` 不變。

**Performance Goals**：
- Portal 不可用時，登入與部門樹在 15 秒內回報（查詢逾時 10 秒）。
- 每日匯入處理約 5,166 位在職人員，加上本機非在職人員的狀態查詢（每批 500 個）。

**Constraints**：
- Portal 唯讀，只讀 contract 列出的欄位。
- 對 Portal 的連線上限為每個 process 3 條（Portal `max_connections` 151，多系統共用）。
- 不新增資料表、migration 或 fallback；只新增 spec 要求的五個環境變數與一個每日排程。

**Scale/Scope**：
- Portal 有 5,166 位在職人員、1,077 個未停用部門。
- 歷史單日離職高峰 174 人，停用門檻設為 500。

## Constitution Check

| Gate | 設計前 | 設計後 |
| --- | --- | --- |
| I. KISS／YAGNI | 通過，但需要記錄複雜度：新增 env、排程、共用模組都是 spec 明確要求 | 通過：用 mysql2 pool 而非第二個 DataSource；沿用 023 規則與 `upsertJobScheduler` 慣例；門檻用常數；移除檔案、回復與 preview 兩段式流程，整體變簡單。理由見 Complexity Tracking |
| II. Server 權威 | 通過 | 通過：資格判斷在 server 用 Portal 即時資料重新驗證；client 契約不變 |
| III. 最小權限與資料最小化 | 注意：`survey_role` 的權限比需要的寬 | 通過：SQL 只選列出的欄位並有單元測試；log 只記筆數；略過的員編只輸出到 CLI 終端機；不保存名冊檔 |
| IV. 系統邊界 | 通過 | 通過：Portal 存取放在 infrastructure；資格規則放 auth、組樹放 esign、匯入放 users；排程只在 worker 註冊 |
| V. 與風險相稱的驗證 | 身分驗證有變動，需要 e2e | 通過：三個登入入口、匯入的交易與並發、排程不重複、隱私都有 e2e；只用合成資料 |

## Project Structure

### Documentation (this feature)

```text
specs/024-portal-hr-source/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/portal-source.md
├── checklists/requirements.md
└── tasks.md            # 由 /speckit-tasks 產生
```

### Source Code

```text
server/src/
├── infrastructure/portal/                        # 新增，與 database/ 同層
│   ├── portal.config.ts                          # PORTAL_MYSQL_*，第一次使用時才檢查必填值
│   ├── portal-directory.service.ts (+spec)       # mysql2 pool 與四個查詢，SQL 欄位白名單測試
│   ├── portal.types.ts                           # Portal 資料列型別
│   └── portal.module.ts
├── features/auth/
│   ├── services/eligible-staff.service.ts (+spec)  # 新增：lookupEligibleStaff 改查 Portal
│   ├── dto/staff-lookup.dto.ts                   # 從 feastogether/types 搬來，規則不變
│   ├── services/auth.service.ts                  # 改：注入 EligibleStaffService
│   ├── services/oauth-identity.service.ts        # 改：同上
│   └── auth.module.ts                            # 改：import PortalModule；保留 FeastogetherModule（staff/login）
├── features/esign/
│   ├── services/org-chart.builder.ts (+spec)     # 新增：移植 fgapi OrgChartBuilder
│   ├── dto/org-chart.dto.ts                      # 從 feastogether/types 搬來（OrgDepartmentDto、parseOrgChart）
│   ├── services/esign-signer-candidate.service.ts  # 改：改用 Portal 來源，換快取命名空間
│   ├── dto/employee-directory-response.dto.ts    # 改：更新 import 路徑
│   └── esign.module.ts                           # 改：import PortalModule，移除 FeastogetherModule
├── features/users/
│   ├── portal-user-sync.rules.ts (+spec)         # 新增：正規化、略過、規劃（含停用）、彙總
│   ├── services/portal-user-sync.service.ts      # 新增：讀 Portal 後在單一交易中鎖定並寫入
│   └── portal-user-sync.module.ts                # 新增：給 worker 與 CLI 共用
├── worker/users/                                 # 新增，只由 worker.module.ts import
│   ├── portal-user-sync.constants.ts
│   ├── portal-user-sync.scheduler.ts (+spec)     # upsertJobScheduler 0 4 * * * Asia/Taipei
│   ├── portal-user-sync.processor.ts (+spec)
│   └── portal-user-sync-worker.module.ts
├── worker.module.ts                              # 改：import PortalUserSyncWorkerModule
├── maintenance/
│   ├── portal-users.ts                           # 改寫：Nest app context；sync --dry-run／--allow-deactivations
│   ├── portal-users.spec.ts                      # 改寫：參數解析與結束碼
│   ├── portal-users-source.ts                    # 刪除：HEX TSV 解析，規則移到 rules.ts
│   ├── portal-users-import.ts                    # 刪除：搬到 PortalUserSyncService
│   ├── portal-users-store.ts                     # 刪除：私有檔案
│   └── portal-users-recovery.ts                  # 刪除：回復
├── infrastructure/http-client/feastogether/
│   ├── feastogether.client.ts                    # 改：移除三條路徑的特例
│   ├── services/feastogether-hr.service.ts       # 改：移除 getStaffEmails、lookupStaff、lookupEligibleStaff
│   ├── services/feastogether-department.service.ts  # 改：移除 getOrgChart
│   ├── types/staff-emails.parser.ts (+spec)      # 刪除
│   ├── types/staff-lookup.dto.ts (+spec)         # 搬到 auth
│   ├── types/org-chart.dto.ts (+spec)            # 搬到 esign
│   └── services/staff-emails-source.spec.ts      # 刪除
└── docs/portal-user-import.md                    # 改寫：每日排程、dry-run、門檻確認、故障處理

server/test/
├── synthetic-portal.helper.ts                    # 新增：臨時合成 Portal 資料庫（沿用 test/*.helper.ts 慣例）
├── portal-user-sync.e2e-spec.ts                  # 新增：取代 portal-user-import 的 preview/apply 段落
├── portal-user-import.e2e-spec.ts                # 改：只保留 repository 的查詢與鎖定測試
├── portal-user-recovery.e2e-spec.ts              # 刪除
├── org-chart.e2e-spec.ts                         # 改：改用合成 Portal
├── （auth 相關 e2e）                              # 改：三個登入入口改用合成 Portal
├── 約 8 個 esign／mail e2e                        # 改：移除 getStaffEmails 的 stub
├── performance/esign-export-benchmark.ts         # 改：覆寫 EligibleStaffService
└── jest-e2e.json                                 # 改：testRegex 加入新檔

server/.env.example                               # 加 PORTAL_MYSQL_*，值為佔位；測試由 helper 依 DB_MYSQL_* 設定，不改 .env.test.example
```

**Structure Decision**：沿用 server 既有的 feature 分層。Portal 連線依使用者指定放在 infrastructure，與 database 同層。業務規則分別放在 auth、esign、users。排程只在 worker 註冊，CLI 與 worker 共用同一個匯入服務。

## 實作順序

1. **Portal 基礎**：config、directory service、module；SQL 欄位白名單單元測試；合成 Portal 測試資料庫。
2. **部門樹（US1）**：builder 加移植的 fgapi 測試情境；改 signer candidate service；EsignModule 換成 PortalModule；更新 org-chart e2e。
3. **登入（US2）**：EligibleStaffService 與 DTO 搬家；auth 與 oauth-identity 換注入；三個入口的 e2e。
4. **匯入（US3）**：rules 與 service（含停用與門檻）；worker 的 scheduler 與 processor；改寫 CLI；刪除舊的 maintenance 檔與回復；匯入 e2e。
5. **移除饗賓人路徑**：刪除 hr／department 方法與相關型別、清理 client 特例、刪除 e2e 的 stub；確認 `rg "hr/(org_chart|staff_lookup|staff_emails)" server/src` 沒有結果。
6. **文件**：runbook、`.env.example`。Spec 006／023 的註記已經完成。

## UAT 上線前置（維運）

- 在 `/home/feasteng/deploy/intranet-uat/server.env` 加入 `PORTAL_MYSQL_*`（`survey_role`）。`docker-compose.uat.yml` 的 server 與 worker 都透過 `x-backend` 載入這個檔。
- 部署後先跑 `sync --dry-run`；第一次停用人數若超過 500，先確認停用人數合理，再帶 `--allow-deactivations` 執行。
- 正式環境由 SRE 依 UAT 架構建置，上線前同樣驗證連線與兩張表的讀取權限。

## Complexity Tracking

| 新增的複雜度 | 目前的需要 | 不採用更簡單做法的原因 | 日後移除成本 |
| --- | --- | --- | --- |
| 五個 `PORTAL_MYSQL_*` 環境變數 | spec FR-001 與使用者決策 | 帳密不能寫進程式或 repo | 低：刪除 config 與 env |
| 新的 infrastructure 模組（Portal） | auth、esign、users 三個 feature 共用 | 各自連線會重複建 pool 與逾時設定 | 低：單一模組 |
| 每日 04:00 排程 | 使用者決策 3、FR-008 | 人工匯入就是要取代的痛點；沿用既有 `upsertJobScheduler`，不新增 dependency | 低：刪除 worker/users |
| 停用門檻與 `--allow-deactivations` 確認 | spec Q1-A、FR-013、SC-009 | 沒有門檻時，Portal 狀態大量出錯會停用全公司；門檻用常數，不開成 env | 低：一個常數加一個 CLI 參數 |
