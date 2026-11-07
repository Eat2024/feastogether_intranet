# Specification Quality Checklist: 側邊選單設定化與權限連動

**Purpose**: 進入 plan 前的需求品質檢查。
**Created**: 2026-11-04
**Feature**: [spec.md](../spec.md)
**Marker Semantics**: 勾選代表需求品質已審閱，不代表功能已實作。

## Content Quality

- [x] `/api/auth/me` 與集中 routes／menu 是使用者確認的公開契約／設定方式；其餘技術實作留在 plan。
- [x] 聚焦可見導覽與權限一致的使用者價值。
- [x] 使用者故事與選單行為可直接理解。
- [x] 模板必要章節已完成。

## Requirement Completeness

- [x] 無待釐清標記或模板佔位文字。
- [x] 權限、群組與獨立項目規則可測試。
- [x] 成功標準可量測。
- [x] 成功標準描述可見結果而非技術性能。
- [x] 初次載入、切換、撤權及失敗情境已列出。
- [x] 空群組、無 children、未知能力、iframe 與原型頁面邊界明確。
- [x] 不做管理／OAuth 前端及全頁按鈕改造，範圍清楚。
- [x] 027 身分及 028 能力契約依賴已列出。

## Feature Readiness

- [x] 功能需求對應使用故事或邊界情境。
- [x] 員工、Super user、設定維護與失敗處理旅程完整。
- [x] 可用選單矩陣及直接存取負向測試驗收結果。
- [x] 契約／快取詳細設計留待 plan，未夾帶實作。

## Notes

- 已明定獨立項目也過濾，避免搬入 CKS 的無條件顯示例外。
- 前端重新驗證時更新不等同後端即時撤權；兩份 spec 的保證已區分。
- 未讀取能力前不先顯示全選單，切換身分不沿用快取。
- 2026-11-07 重驗：前端不取得role，只按`moduleKey`精確比對`auth/me`的effective permissions；跨module fixture不加入正式選單。
- 未執行功能測試；extensions.yml 不存在，無前後置 hooks。
