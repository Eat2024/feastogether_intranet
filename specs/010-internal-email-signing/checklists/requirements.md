# Specification Quality Checklist: 內部員工 Email 邀請與 OTP 簽署

**Purpose**: 驗證規格完整性與規劃準備度

**Created**: 2026-10-21

**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] 聚焦使用者需求，不預先決定程式、資料表或技術分層；使用者指定的上游端點列為整合依賴
- [x] 聚焦使用者價值與業務需求
- [x] 使用繁體中文描述可觀察行為
- [x] 所有必要章節已完成

## Requirement Completeness

- [x] 無未解決的 NEEDS CLARIFICATION 標記；預設與限制明列於 Assumptions
- [x] 需求可測試且可辨識預期結果
- [x] 成功條件可量測
- [x] 成功條件描述使用者結果，不依賴特定技術實作
- [x] 主流程驗收情境已定義
- [x] 失敗、缺漏、並發、跨人與舊文件邊界已列出
- [x] 明確區分本次後端實作與後續前端串接，不將畫面列為本次完成條件
- [x] 上游契約、相依規格與預設已列出

## Feature Readiness

- [x] 功能需求有對應使用者情境、邊界或可驗證條件
- [x] 情境涵蓋選人、信箱、邀請、OTP、簽署、拒簽、副本及催簽／補簽
- [x] 成功條件涵蓋需求的主要結果
- [x] 未提前指定新的程式結構或 schema

## Notes

- 已完成規格檢核與 Phase 0／1 plan，產出 research、data-model、contracts、quickstart，並完成 tasks.md 的44項任務拆分；全部任務尚未執行，未修改執行程式。
- 使用者明確指定兩個 fgapi endpoint，因此保留其已核對契約作為依賴；不將 skill 的「無 API 細節」要求解讀為刪除使用者需求。
- Constitution 已依使用者本次需求及 grilling 決策同步為 1.5.0，內部 Email 邀請的文字衝突已解除；仍要求 OTP 且不得授予一般員工登入。此清單不代表功能已實作或已完成測試。
- 2026-10-21 grilling 決策已由使用者確認並寫入 Clarifications：缺信箱阻擋整份發起、地址固定、同信箱逐人照寄、僅後端與前端交接規格、納入人工催簽及補簽、不保留舊文件免 OTP 分支。
- 已新增前端工程師 Agent 交接文件與具體 API contract，標明規劃中的新增／變更；後端實作時須再核對 Swagger 與契約一致，未宣稱前端已完成。
- 本次驗收改為後端 API／整合測試與交接文件；畫面端到端驗收由前端後續執行。既有證據不改寫、不自行刪除資料。
- `.specify/extensions.yml` 不存在，無 before_specify 或 after_specify hooks 可執行。
