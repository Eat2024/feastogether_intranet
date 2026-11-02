# Implementation Plan: 電子簽部門可見範圍與唯讀瀏覽

**Branch**: `dev`（setup-plan 回傳的 feature 識別為 `017-department-document-visibility`；未切換 Git 分支） | **Date**: 2026-11-02 | **Spec**: [spec.md](spec.md)

**Input**: `specs/017-department-document-visibility/spec.md`

**Status**: Phase 1 設計完成；同部門瀏覽及匯出、發起人管理、UAT 舊文件歸屬皆已確認。尚未產生 tasks 或實作。

## Summary

以既有文件列表的 `role=dep` 顯示同部門文件；文件建立時固定保存部門代碼與名稱，員工調職不搬移舊文件。同部門員工可唯讀瀏覽，所有修改及流程管理仍由原發起人執行。既有 UAT 文件依使用者決策統一歸 IT策略本部系統開發部，不能把員工帳號也統一改部門。

部門資料由可信登入流程同步，不由前端決定。沿用現有表與 API，不新增角色系統、部門管理頁、排程或環境變數。詳細欄位與 API 初步盤點見 [impact-analysis.md](impact-analysis.md)。

## Technical Context

**Language/Version**: TypeScript；既有 Next.js 16／React 19 client、NestJS 11 server。

**Primary Dependencies**: MUI、TanStack Query、Fastify、TypeORM；沿用現有套件，不增加 dependency。

**Storage**: MySQL 的 users／esign_documents 新增部門欄位；Redis、私有檔案儲存及簽署證據格式維持既有責任。

**Testing**: server Jest 單元測試、MySQL／Redis E2E、schema migration 測試；client lint/build 與實際雙帳號瀏覽／操作驗收，client 無測試框架。

**Target Platform**: 既有 UAT Web／Portal 入口與獨立 worker。

**Project Type**: pnpm workspace，client + server。

**Performance Goals**: 部門條件在資料庫查詢時套用，不載入全公司文件交前端裁切；保留既有更新時間排序與前端篩選／分頁，不新增未量測的 SLA。

**Constraints**: 不改簽署證據；不信任前端部門；同部門只讀不能借道管理 GET 取得邀請憑證；新舊資料切換須可核對；不覆蓋工作區其他變更。

**Scale/Scope**: 全部正式登入入口、文件列表／建立／唯讀詳情與管理權限；匯出、歷史紀錄與各類下載一併限同部門（FR-010）。舊文件資料量需在部署前唯讀盤點；指定目標為 `1029030000`／IT策略本部系統開發部，代碼以字串保存，執行前核對環境對應。

## Constitution Check

| Gate | 結果 | 說明 |
|---|---|---|
| KISS/YAGNI | 通過 | 三個必要欄位，沿用列表與存取政策，不新增表、排程、角色系統 |
| Server 權威 | 通過 | 後端讀可信部門並比對快照，所有寫入仍驗證發起人；UI 按鈕不是授權 |
| 最小揭露 | 通過 | 唯讀內容裁切憑證與管理資訊；所有一般匯出與筆數均按文件部門驗證 |
| 邊界與契約 | 通過（草案） | 前後端只交換 DTO，不公開底層 User／entity；保留本人指派與外部入口 |
| 證據完整性 | 通過 | 只補文件歸屬，不重算／覆寫 payload、manifest、signature、PDF |
| 風險相稱驗證 | 已規劃 | 存取矩陣、調職、各登入入口、UAT 回填、migration 與直接 API 負向測試 |
| Phase 1 前置條件 | 通過 | FR-010 已由使用者確認，明確取代 Spec 015 全員可見規則 |

Phase 0 及 Phase 1 後重新檢查皆通過；本輪完成規劃文件，不建立實作 tasks、不執行功能修改或部署。

## Project Structure

### Documentation (this feature)

```text
specs/017-department-document-visibility/
├── spec.md
├── impact-analysis.md
├── plan.md
├── research.md
├── checklists/requirements.md
├── data-model.md
├── contracts/department-access.md
└── quickstart.md
```

### Source Code (repository root)

```text
client/src/api/{types,requests,queries}/
client/src/features/esign-documents/
client/src/app/forms/
server/src/features/auth/services/
server/src/features/users/{entities,repositories}/
server/src/features/esign/{controllers,dto,entities,repositories,services}/
server/src/infrastructure/database/{migrations,schema.sql}
server/src/common/errors/
server/test/
```

**Structure Decision**: 沿用 feature 內服務與 EsignAccessPolicyService；新增部門讀取政策與原建立人修改政策分開，不把原 `checkEsignCreator` 放寬成同部門，以免連帶放寬所有寫入。

## 實作階段草案（不是 tasks）

1. **部門資料與 schema**：users 新增上游代碼、文件新增建立部門快照與查詢索引；各正式登入入口同步，缺值不得殘留舊代碼。驗證 migration up/down 與 schema 對齊。
2. **建立流程與 UAT 遷移**：建立交易保存快照；缺部門拒絕且清理上傳。UAT 切換先停止建立／編輯，盤點既有文件 ID 集合及原值，核對使用者指定的 `1029030000`／IT策略本部系統開發部，再一次性回填該集合；不能用新建時的預設部門讓後續文件全部落到 IT。
3. **部門列表與讀取權限**：增加 dep 查詢，以目前 User 部門比對文件快照；保留 created／assigned 個人範圍。新增建立人或同部門的讀取判斷；檢查直接 ID 讀取、原始 PDF 與歷程，不只保護列表。
4. **唯讀內容與前端**：列表使用 dep；回傳 isCreator 以區分操作。同部門可檢視草稿與已發起文件；草稿唯讀不能導入可寫編輯器。詳情頁不得掛載寫入控制，不能因頁面載入觸發邀請、重寄或備註寫入。來源預覽不代表他人完成副本／ZIP 下載授權。
5. **管理操作保護**：建立人檢查與文件狀態規則保留；涵蓋草稿、名單／欄位、發起、刪除、停止、補簽、通知及備註。簽署動作仍需本人指派，發起人與同部門皆不可代簽。
6. **匯出（FR-010 已確認）**：exportable-documents、歷史列表與各類筆數、Excel 資料、ZIP 建立／重試／查詢／下載、PDF 重下載全部補入 userId 與文件部門檢查，更新 Spec 015。一般匯出無建立人跨部門例外；本人簽署副本入口維持既有指派資格。
7. **驗證與部署**：同／跨部門／建立人／指定簽署人矩陣、調職、缺值、直接 HTTP、憑證裁切、各登入入口、回填前後證據及筆數。完成對應 lint/test/build；再提供可執行的 UAT 切換與回滾程序。

## UAT 舊資料決策

- 使用者指定：既有 UAT 電子簽全部歸 IT策略本部系統開發部，包含各狀態及仍保留的軟刪除紀錄；軟刪除回填不使其恢復可見。
- 不回填或改寫 User 部門、不改 createdByUserId、不改簽署與稽核證據。
- 欄位 migration 與 UAT 特定回填分開；其他環境不得自動套 IT 部門。
- 部署前核對指定代碼 `1029030000` 的部門名稱、切換時點與舊文件 ID 清單，暫停寫入以避免漏接切換期間的新資料；以影響筆數核對。
- 回填前保存 ID 與欄位原值，失敗時只回復該清單，不修改切換後新建資料。不得自行清除 UAT 文件。

## Complexity Tracking

未提出違反 constitution 的例外；FR-008／009／010 皆已確認，無未關閉需求。資料量、正式代碼對應與回填前清單於部署前驗證。

## Phase 1 產物與定稿結果

- [data-model.md](data-model.md)：三個欄位、索引與 UAT 回填／回滾設計。
- [contracts/department-access.md](contracts/department-access.md)：API、授權矩陣、讀取資料裁切與錯誤。
- [quickstart.md](quickstart.md)：本機及 UAT 驗收步驟；是未來實作的驗證指南，非已通過的測試報告。
- 重新檢查 constitution：無新增表、環境變數、排程或依賴，所有授權留在 server，證據與本人簽署邊界不變。
