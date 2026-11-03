# Specification Quality Checklist: Portal 直連取代饗賓人人資查詢

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-03
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- spec 中出現的饗賓人端點名稱（`hr/org_chart`、`hr/staff_lookup`、`hr/staff_emails`、`staff/login`）與 Portal 資料表名稱，用來指認被取代的外部依賴與資料來源，沿用 Spec 006／023 的寫法，不是實作設計。沒有指定語言、框架、模組結構或連線函式庫。
- 「放在 server 基礎設施層、與資料庫連線同層」是使用者的初步指定，記錄於背景；實際目錄與模組設計留給 plan。
- 連線帳號已確定使用 `survey_role`；因為帳號權限比需要的寬，欄位限制改由 FR-002 規定應用程式負責。
- 停用門檻的實際值刻意留給 plan，依 UAT 資料訂定；spec 只規定要有門檻，以及超過時的可測行為（SC-009）。
- 2026-11-03 第一輪驗證全部通過。
- 2026-11-03 第二輪：寫入使用者的決策（登入讀 Portal、`survey_role`、每日 04:00 匯入、部門樹讀 Portal、離職自動停用、不保存名冊檔與回復功能）。兩個待澄清項目都已解決，重新驗證全部通過。
- 2026-11-03 第三輪（plan 階段）：依使用者回覆，不合法資料列改為個別略過；並依 BullMQ 實際行為，把「錯過排程不補跑」改為「恢復後執行一次」、把並行防護改為交易內鎖定。重新驗證全部通過。
