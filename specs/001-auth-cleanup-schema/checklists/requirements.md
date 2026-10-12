# Specification Quality Checklist: 舊授權清理與電子簽資料基礎

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-12
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

- 依產品澄清重寫 Spec 1：登入流程不在本規格；保留既有 SSO 串接，僅清理角色／permission 舊功能。
- Schema 範圍採資料字典與 ER Model 的十二類 Stage 1 實體，舊 `doc/esign-db-schema.sql` 不作為正式來源。
- 已確認採一次建立全部十二類資料實體，並在 spec 記錄 schema-first 例外理由、較小方案不足與日後移除成本。
- 已確認所有現有資料庫皆可重建；Spec 1 採乾淨初始 schema，不要求舊 Auth/RBAC 資料向前遷移。
- 已確認移除全部舊使用者管理端點及其專用稽核，只保留登入與電子簽內部流程需要的員工資料能力。
- 文件主檔已納入浮水印與拒絕簽署設定，預設值及發起後鎖定規則均已定義。
- 已確認拒絕簽署不會中止其他簽署人；所有人皆已簽署或拒絕且最終產物完成後，文件可完成並保留拒絕結果。
- 已確認 Stage 1 支援內部員工與 Email 外部簽署人（含面試錄取人員），不支援手機簽署；外部身分驗證流程延後至對應功能規格。
- 本規格只建立資料基礎，不代表電子簽 API、檔案處理或前端串接已完成。
- 已確認全部 `DATE`／日期時間欄位都建立專屬單欄索引，既有複合索引不作為替代；對應 FR-030 與 SC-012 可直接驗收。
- 已確認一般 API 採全域預設員工 session 驗證並移除 `RegisterApi`；外部 Email 簽署人未來使用受限外部 session，不建立假員工，也不以裸 `@Public()` 放行。
