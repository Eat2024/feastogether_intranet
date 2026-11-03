# 06: 整合驗證與維運交接

**What to build:** 整合驗證與維運交接，依下列驗收及 Spec 023 完成。

**Status:** ready-for-agent

**Blocked by:** [03-local-resolution-initiation](03-local-resolution-initiation.md)、[04-local-mail-policy](04-local-mail-policy.md)、[05-repeatable-import-recovery](05-repeatable-import-recovery.md)

**Source:** [Spec](../../../specs/023-portal-user-email/spec.md)、[Plan](../../../specs/023-portal-user-email/plan.md)、[Tasks](../../../specs/023-portal-user-email/tasks.md)。

**Scope:** T023–T026；全體FR；SC-001–007。精確檔案與測試入口見 tasks 對應ID。

## Acceptance Criteria

- [ ] 更新被023取代的既有來源描述，保留舊驗證紀錄，不將022背景發起列為完成。
- [ ] 依quickstart完成server/client/root驗證並記錄結果，5001人前後各三次分階段量測及HR零呼叫證據。
- [ ] 確認更新責任人／時機、受控artifact與清理、server/worker一致部署及應用回滾流程；未部署／未寄信明列。
- [ ] 完成code review與整合commit後才改resolved；本ticket不授權部署、真實寄信或遠端PR。
- [ ] 相關驗證通過，附實際結果及未驗證限制；整合至單一功能分支後追加commit紀錄，才可改為resolved。

## Comments & Implementation Results

2026-11-03：僅建立ticket，尚未實作；ready-for-agent 不表示可忽略 Blocked by，前置皆resolved才可開始。後續結果追加於此。
