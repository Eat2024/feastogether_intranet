# 01: 本機員工查詢基礎

**What to build:** 本機員工查詢基礎，依下列驗收及 Spec 023 完成。

**Status:** resolved

**Blocked by:** 無

**Source:** [Spec](../../../specs/023-portal-user-email/spec.md)、[Plan](../../../specs/023-portal-user-email/plan.md)、[Tasks](../../../specs/023-portal-user-email/tasks.md)。

**Scope:** T001–T003；FR-001、015。精確檔案與測試入口見 tasks 對應ID。

## Acceptance Criteria

- [x] 核對既有email migration，不新增schema；新增專用批次選取email／鎖定方法，不改一般User查詢的select:false。
- [x] 驗證精確員編、部門collation與固定鎖順序；只用合成資料與隔離測試DB。
- [x] 相關驗證通過，附實際結果及未驗證限制；整合至單一功能分支後追加commit紀錄，才可改為resolved。

## Comments & Implementation Results

2026-11-03：僅建立ticket，尚未實作；ready-for-agent 不表示可忽略 Blocked by，前置皆resolved才可開始。後續結果追加於此。

### 實作驗證

- T001–T003完成：兩個顯式email批次讀取介面，鎖定ID升序、每批最多500，一般查詢仍select:false。
- 真實MySQL隔離schema測試4項通過（先紅後綠）；501人兩次查詢、精確員編／部門、一般save保留email、交易鎖競態均驗證。
- 變更檔案ESLint零錯誤／警告，server build通過；未操作UAT。

整合commit：`e14b26a`（feat/023-portal-user-email）。commit hook root lint與server單元測試通過。
