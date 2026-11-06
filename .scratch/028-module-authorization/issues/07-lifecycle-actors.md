# 07: 管理者執行文件生命週期並保留真實操作者

**What to build:** 管理員／Super 對合法文件完成發起、重試、停止、補簽與提醒，背景工作沿真實受理操作者執行，不冒寫原建立者。

**Blocked by:** [028-06](06-cross-department-documents.md)

**Status:** ready-for-agent

**Source:** [Spec](../../../specs/028-module-authorization/spec.md)、[Plan](../../../specs/028-module-authorization/plan.md)、[Tasks](../../../specs/028-module-authorization/tasks.md)、[API 契約](../../../specs/028-module-authorization/contracts/api-behavior.md)、[權限目錄](../../../specs/028-module-authorization/contracts/permissions.md)、[維運契約](../../../specs/028-module-authorization/contracts/operations.md)

**Scope:** T043、T044、T045、T046、T047。

## Acceptance Criteria

- [ ] 發起 job 和通知保存真 actor，employee 有 user、super／system 無 user，歷史可證明值正確回填且 schema CHECK 拒非法組合。
- [ ] worker 取持久化 job actor，不拿 document creator 冒充操作者；同 job retry 不改原 actor，新 job 才記新提交者。
- [ ] 所有流程驗 manage 與原建立人或 manage-all，狀態／期限／工作鎖／通知節流與證據規則不被 Super 繞過。
- [ ] poll、issues、input、retry 重新核對當前能力；已受理工作可完成，但撤權後的後續存取不可沿舊權限。
- [ ] 端到端跑 HTTP 到 worker 到可查結果，輸出真實 actor 且無個資／簽名／邀請洩漏，原 creator／department 不變。

## Comments & Implementation Results

- 2026-11-06：依使用者確認的拆分提案建立；尚未開始實作。前置 ticket 皆為 `resolved` 才可開始。
