# 08: 整合驗證與交接

**What to build:** 所有 tickets 整合後，完整跑過 server 與 root 的驗證，在 quickstart 記錄實際結果與未驗證的限制，並確認 Spec 006／023 的取代註記仍正確，讓這個分支可以進 PR review。

**Status:** ready-for-agent

**Blocked by:** [01](01-portal-connection.md)、[02](02-org-chart-from-portal.md)、[03](03-login-staff-from-portal.md)、[04](04-portal-user-sync-core.md)、[05](05-daily-schedule.md)、[06](06-manual-cli-runbook.md)、[07](07-remove-feastogether-hr-paths.md)

**Size:** S

**Source:** [Spec](../../../specs/024-portal-hr-source/spec.md)、[Plan](../../../specs/024-portal-hr-source/plan.md)、[Tasks](../../../specs/024-portal-hr-source/tasks.md)、[Contracts](../../../specs/024-portal-hr-source/contracts/portal-source.md)。

**Scope:** T033–T034；FR-012（Spec 006／023 註記）；SC-001–SC-010 的總驗收。

## Acceptance Criteria

- [ ] `pnpm -C server lint:check`、`test`、`build`、`test:e2e`，以及 root 的 `pnpm lint`、`pnpm build` 都通過；client 沒有變更。
- [ ] quickstart 追加實際結果，並逐項列出 SC-001–SC-010 的驗證方式；沒有驗證到的項目要寫出原因。
- [ ] Spec 006 與 Spec 023 的 Spec 024 註記和實際取代範圍一致。
- [ ] UAT 上線前的維運步驟（`server.env` 加入 `PORTAL_MYSQL_*`、部署後先跑 dry-run）已寫在 runbook 或交接說明中；不操作 UAT，不建立遠端 PR，除非使用者要求。
- [ ] 相關的 lint、單元測試、build 與 e2e 通過，並附上實際結果與未驗證的限制；整合到 `feat/024-portal-hr-source` 並追加 commit 紀錄後，才可以改成 resolved。

## Comments & Implementation Results

2026-11-03：只建立 ticket，尚未實作。ready-for-agent 不代表可以忽略 Blocked by；前置 ticket 都 resolved 後才能開始。實作結果追加在這裡。
