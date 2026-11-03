# 05: worker 每天 04:00 自動執行匯入

**What to build:** worker 每天台北時間 04:00 自動執行 ticket 04 的匯入；部署多個 worker 也只會執行一次，停機錯過時恢復後補跑一次。成功、超過停用門檻與失敗都寫入不含個資的 log。

**Status:** ready-for-agent

**Blocked by:** [04-portal-user-sync-core](04-portal-user-sync-core.md)

**Size:** S

**Source:** [Spec](../../../specs/024-portal-hr-source/spec.md)、[Plan](../../../specs/024-portal-hr-source/plan.md)、[Tasks](../../../specs/024-portal-hr-source/tasks.md)、[Contracts](../../../specs/024-portal-hr-source/contracts/portal-source.md)。

**Scope:** T024–T025；US3 情境 1；FR-008；SC-006。

## Acceptance Criteria

- [ ] 沿用 esign 既有的 BullMQ scheduler 寫法：scheduler id 為 `portal-user-sync:daily`、cron 為 `0 4 * * *`、時區為台北；queue 只在 worker 註冊。
- [ ] 兩個 worker 連同一個 Redis 時，只有一個 scheduler，同一個 job 只處理一次；連續 7 天每天恰好觸發一次。
- [ ] job 不重試；log 事件 `portal_users.sync_completed`、`portal_users.sync_blocked`、`portal_users.sync_failed` 只含摘要與分類，不含員編。
- [ ] 相關的 lint、單元測試、build 與 e2e 通過，並附上實際結果與未驗證的限制；整合到 `feat/024-portal-hr-source` 並追加 commit 紀錄後，才可以改成 resolved。

## Comments & Implementation Results

2026-11-03：只建立 ticket，尚未實作。ready-for-agent 不代表可以忽略 Blocked by；前置 ticket 都 resolved 後才能開始。實作結果追加在這裡。
