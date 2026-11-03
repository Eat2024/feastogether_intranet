# 03: 本機解析與發起信箱

**What to build:** 本機解析與發起信箱，依下列驗收及 Spec 023 完成。

**Status:** claimed

**Blocked by:** [01-local-user-foundation](01-local-user-foundation.md)

**Source:** [Spec](../../../specs/023-portal-user-email/spec.md)、[Plan](../../../specs/023-portal-user-email/plan.md)、[Tasks](../../../specs/023-portal-user-email/tasks.md)。

**Scope:** T008–T014；US2；FR-007–009、012。精確檔案與測試入口見 tasks 對應ID。

## Acceptance Criteria

- [x] 每批100解析，未知／停用unavailable，UI提示同步且阻止部分發起；部門樹／快取不變。
- [x] 發起先鎖員工再鎖文件，同一交易取得身分與email快照，並行修改不混用資料；保留外部Email及文件狀態與權限檢查。
- [x] 缺email仍可簽署，通知skipped；DB故障不當缺值，不查HR；候選／登入payload不新增email。
- [x] 5001合成人員與並行案例通過；集中錯誤文案及Swagger來源說明更新而不改既有狀態碼。
- [ ] 相關驗證通過，附實際結果及未驗證限制；整合至單一功能分支後追加commit紀錄，才可改為resolved。

## Comments & Implementation Results

2026-11-03：僅建立ticket，尚未實作；ready-for-agent 不表示可忽略 Blocked by，前置皆resolved才可開始。後續結果追加於此。

### 依賴調整（使用者授權平行實作）

主檔已匯入且可用合成fixture獨立驗收，此ticket僅依賴01的repository基礎；與02工具獨立，整合仍由06驗證。檔案所有權分開，無共同寫入。

2026-11-03：已完成 T008–T014。解析／發起查 users；部門樹與登入保持既有 API。候選 e2e 18 項、草稿與發起 e2e 41 項、核心流程 25 項通過。InnoDB 證實並修正草稿／發起鎖順序倒置，維持原並行測試期待。容量三次比較及最終完整驗證由 06 記錄。等待整合 commit 紀錄後結案。
