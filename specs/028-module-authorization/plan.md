# Implementation Plan: 多子功能角色權限與電子簽授權

**Branch**: `dev`（既有工作分支，未建立或切換專用分支） | **Date**: 2026-11-04 | **Spec**: [spec.md](spec.md)

**Input**: `/specs/028-module-authorization/spec.md`。本次完成設計，不實作程式、不產生 tasks。

## Summary

在027統一actor／session上加入按子功能隔離的多角色聯集授權。有效員工以唯讀規則永久疊加受保護同仁能力，一般角色與指派存MySQL；每次請求讀最新有效關聯。Super user獨占授權管理，API與REPL共用服務、交易和授權稽核。電子簽以明確能力放寬管理者的部門／建立人限制，保留本人簽署、證據及狀態不變量。

五張授權表與必要電子簽actor欄位是本次最小持久變更；不搬整套CKS架構、不建立通用principal表、不做管理前端。本人能力契約供029導覽使用。具體決策見[research.md](research.md)，資料與migration見[data-model.md](data-model.md)，API唯一schema見[contracts/openapi.json](contracts/openapi.json)。

## Technical Context

**Language/Version**: TypeScript 5.7、Node.js >=24.22.1；沿現有workspace版本。

**Primary Dependencies**: NestJS 11、Fastify 5、TypeORM 0.3、既有Portal查核；client Next.js 16／React 19只作必要actor DTO／caller相容。

**Storage**: MySQL既有migration機制；027 opaque session沿MySQL；Redis沿用OAuth交易、限流與BullMQ責任。沒有授權快取、每功能cookie、額外排程或環境變數。

**Testing**: Jest單元與Supertest整合／e2e、MySQL schema suite、既有簽署與檔案存取回歸。

**Target Platform**: 既有HTTP server、獨立worker與027隔離console context。

**Project Type**: pnpm workspace web application；業務授權以server為主。

**Performance Goals**: spec未設額外延遲SLO；避免逐角色N+1，以索引和集合查詢解析有效能力。不得以快取換取下一請求撤權的承諾。

**Constraints**: 不製造員工ID；不恢復026文件／簽署事件歷程；管理者不得代簽或使用他人本人副本；GET不寫入角色；所有HTTP／REPL異動同交易寫必要稽核。

**Scale/Scope**: 正式目錄只有esign與platform；第二子功能只作隔離fixture。21項FR、5個US；覆蓋現有電子簽入口與管理API，不宣稱mock內部簽署前端正式化。

## Constitution Check

| Gate | Phase 0 | Phase 1 設計結果 |
|---|---|---|
| I KISS／YAGNI | PASS | 五表服務目前多角色、跨scope FK與稽核；無module CRUD、deny或角色階層。actor只擴充有真實寫入需求的電子簽資料。 |
| II Server權威與證據 | PASS | 能力guard加資源policy；管理例外只放寬範圍，worker保存原操作者，簽署人與證據不變。 |
| III 最小權限／資料最小化 | PASS | protected同仁、Super-only管理；本人副本另驗本人；audit白名單，不含empId或憑證。 |
| IV 邊界／REST | PASS | GET無副作用、資源式管理API；API與REPL共用服務；029透過契約不import server。 |
| V 風險相稱驗證 | PASS | quickstart要求真MySQL FK／唯一性／並發、session即時撤權及完整簽署回歸；目前僅文件檢查，不冒稱實作已驗證。 |
| Engineering constraints | PASS | 沿現有技術、pnpm及繁中；schema變更已由spec授權，無新增dependency／env／排程。 |

Phase 1重檢通過，沒有未解產品決策或constitution例外。MySQL CHECK／generated column與既有worker細節須於實作測試證明，見quickstart。

## Project Structure

### Documentation (this feature)

```text
specs/028-module-authorization/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── openapi.json
    ├── api-behavior.md
    ├── permissions.md
    └── operations.md
```

`tasks.md`留給後續speckit-tasks；本次不修改spec狀態。

### Source Code (repository root)

```text
server/src/
├── features/authorization/       # 新增：catalog、entities、resolver、管理service/controller、guard
├── features/auth/                # 銜接027 actor／有效session，不複製登入
├── features/esign/               # 現有policy、controller、job、DTO與actor相容
├── infrastructure/database/     # migration、entities登錄、schema snapshot
└── console/                     # 沿027規劃console，加入授權helpers
server/test/                     # schema、authorization與電子簽整合驗收
client/src/api/                  # 最小actor／nullable DTO相容
client/src/features/esign-documents/ # 既有列表super傳role=all、員工仍dep
```

**Structure Decision**: authorization服務負責跨功能聯集與授權管理；esign保有資源與文件不變量。上述authorization／console為規劃位置；實作依027最終console路徑接入，不另建第二個REPL架構。

## Implementation Sequence

1. **027相依確認**：actor union、有效session檢查、Origin、安全error envelope、console維護身分先可用。028不能自行補一套本地登入或將super轉假員工。
2. **資料與catalog**（FR-001～004、006、011、019、021）：建五表、複合scope FK、active role name DB唯一性、版本控制與冪等seed。一般角色首次seed後不覆寫；同仁版本維護且不存逐員工base assignment。
3. **解析與管理**（FR-002、007、010、012～016、020、022）：無cache聯集、Super-only服務、Portal預建員工、CAS指派、同交易audit、API與REPL。`auth/me`合併session view與按module分組的有效permissions，但不回roles。管理assignment把目標資格錯誤轉422，不能使管理者被誤判401登出。
4. **電子簽閉環**（FR-005、008、009、017）：先分類所有入口，再逐一套能力與資源policy；同步actor schema／mapper／worker。Super建立必填有效departmentCode；保留原creator／department。本人副本入口（包括departmentFile與pdf歷史）收緊為本人；合法一般匯出仍依另一能力及範圍。
5. **相容與導入**（FR-018～020、022）：既有client creator employeeNo接受null及kind；DocumentsListView目前明確送dep，改為super送all、employee保留dep，不新增UI。029使用`auth/me`共用契約。依核定名單預指派，再停流量切換完整新授權版本，不混跑舊放行實例。
6. **驗收與回復演練**：按quickstart驗證全部US／SC、端點分類無遺漏、既有關聯與證據保持。未完成授權名單或schema驗證不切換。

API細節、scope矩陣與維運流程分別以[api-behavior.md](contracts/api-behavior.md)、[permissions.md](contracts/permissions.md)、[operations.md](contracts/operations.md)為準。

## Complexity Tracking

沒有constitution違反。必要複雜度：多對多關聯與scope FK不能以users單一role欄位取代；Super user無員工ID而需建立／發起文件，故擴充相關表的actor discriminator與nullable員工FK。移除成本限於授權feature及電子簽actor相容欄位，沒有共用principal框架或全域AuditSubscriber重構。
