# Specification Quality Checklist: 電子簽依部門顯示

**Purpose**: 檢查需求與影響盤點完整性，不代表實作完成。
**Created**: 2026-11-02
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] 需求以使用者價值與可觀察行為描述；API／DB 細節集中在 impact-analysis.md。
- [x] 使用者情境、需求、實體、成功條件、假設等必要章節已完成。
- [x] 區分目前程式行為與待實作部門方案。

## Requirement Completeness

- [x] FR-008：同部門可唯讀瀏覽，發起人獨有修改與流程管理權。
- [x] FR-009：既有 UAT 文件統一歸 IT策略本部系統開發部，代碼 `1029030000` 已由使用者指定，執行前核對環境對應。
- [x] FR-010：使用者確認匯出紀錄與 Excel／PDF／ZIP 一律限同部門，取代 Spec 015 全員可見規則。
- [x] 已確認需求可測試，成功條件可量測且不依特定技術。
- [x] 含調職、缺代碼、部門改名、同名異碼、舊 session、軟刪除與偽造參數案例。
- [x] 依賴與預設假設明確；不新增未要求的表、排程、環境變數與泛用授權層。

## Feature Readiness

- [x] 已定義部門列表、文件快照及切換三條使用者流程。
- [x] 已盤點三個候選欄位、既有 API 修改位置、OAuth 缺口、migration 與測試範圍。
- [x] 三項決策已確認，plan／research／data-model／contracts／quickstart 已完成，可進入 tasks；尚未實作。

## Notes

- 本輪只產出規格；先前 role=all 的程式、測試與舊 spec 修改已撤回。
- 尚未連線 UAT 查詢部門完整度或修改資料。
- .specify/extensions.yml 不存在，無 before_specify／after_specify hooks 要執行。
- [x] 僅代表文件品質已檢查，不代表功能已交付。
