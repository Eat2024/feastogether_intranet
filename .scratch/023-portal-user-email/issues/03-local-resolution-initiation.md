# 03: 本機解析與發起信箱

**What to build:** 本機解析與發起信箱，依下列驗收及 Spec 023 完成。

**Status:** ready-for-agent

**Blocked by:** [01-local-user-foundation](01-local-user-foundation.md)、[02-controlled-import](02-controlled-import.md)

**Source:** [Spec](../../../specs/023-portal-user-email/spec.md)、[Plan](../../../specs/023-portal-user-email/plan.md)、[Tasks](../../../specs/023-portal-user-email/tasks.md)。

**Scope:** T008–T014；US2；FR-007–009、012。精確檔案與測試入口見 tasks 對應ID。

## Acceptance Criteria

- [ ] 每批100解析，未知／停用unavailable，UI提示同步且阻止部分發起；部門樹／快取不變。
- [ ] 發起先鎖員工再鎖文件，同一交易取得身分與email快照，並行修改不混用資料；保留外部Email及文件狀態與權限檢查。
- [ ] 缺email仍可簽署，通知skipped；DB故障不當缺值，不查HR；候選／登入payload不新增email。
- [ ] 5001合成人員與並行案例通過；集中錯誤文案及Swagger來源說明更新而不改既有狀態碼。
- [ ] 相關驗證通過，附實際結果及未驗證限制；整合至單一功能分支後追加commit紀錄，才可改為resolved。

## Comments & Implementation Results

2026-11-03：僅建立ticket，尚未實作；ready-for-agent 不表示可忽略 Blocked by，前置皆resolved才可開始。後續結果追加於此。
