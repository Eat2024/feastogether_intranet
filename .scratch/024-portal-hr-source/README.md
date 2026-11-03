# Spec 024 tickets 索引

來源：[specs/024-portal-hr-source](../../specs/024-portal-hr-source/)。共 34 項 tasks，切成 8 張 tickets，每項 task 只歸一張 ticket。

大小：S 是 1–2 項、偏機械性的工作；M 是單一模組 3–6 項；L 是跨模組、含大量 e2e 的工作。

| Ticket | 工作 | Tasks | 大小 | Blocked by |
| --- | --- | --- | --- | --- |
| [01](issues/01-portal-connection.md) | Portal 唯讀連線基礎 | T001–T006 | M | 無 |
| [02](issues/02-org-chart-from-portal.md) | 選人部門樹改由 Portal 提供 | T007–T013 | L | 01 |
| [03](issues/03-login-staff-from-portal.md) | 三個登入入口的員工資料改讀 Portal | T014–T019 | L | 01 |
| [04](issues/04-portal-user-sync-core.md) | 每日匯入核心 | T020–T023 | L | 01 |
| [05](issues/05-daily-schedule.md) | worker 每天 04:00 自動執行 | T024–T025 | S | 04 |
| [06](issues/06-manual-cli-runbook.md) | 手動匯入 CLI 與 runbook 改寫 | T026–T028 | M | 04 |
| [07](issues/07-remove-feastogether-hr-paths.md) | 移除饗賓人三條人資路徑 | T029–T032 | S | 02、03 |
| [08](issues/08-integration-handoff.md) | 整合驗證與交接 | T033–T034 | S | 01–07 |

- 01 完成後，02、03、04 可以平行；05 與 06 都接在 04 後面，彼此可以平行。
- 只完成 01、02 就是 MVP：部門樹脫離饗賓人。
- 共用的 `server/test/jest-e2e.json` 會被 01、04 修改，需要依序整合；會重設同一個測試資料庫的 e2e 不要同時跑。
- 使用單一功能整合分支 `feat/024-portal-hr-source`，各 ticket 可以分開 commit 審查。只有使用者要求時才建立遠端 PR。
