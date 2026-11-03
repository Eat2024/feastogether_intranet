# 06: 手動匯入 CLI 與 runbook 改寫

**What to build:** 維運人員可以隨時手動執行一次匯入，規則與每日匯入相同：
- `sync --dry-run`：只預覽摘要、被略過的員編與要停用的人數，不寫入。
- 正式執行：停用人數超過門檻時，必須帶 `--allow-deactivations <N>`，且 N 等於本次停用人數。

023 的 HEX TSV 檔案輸入、預覽檔、原值檔與 rollback 全部移除；runbook 改寫成每日自動匯入的維運說明。

**Status:** ready-for-agent

**Blocked by:** [04-portal-user-sync-core](04-portal-user-sync-core.md)

**Size:** M

**Source:** [Spec](../../../specs/024-portal-hr-source/spec.md)、[Plan](../../../specs/024-portal-hr-source/plan.md)、[Tasks](../../../specs/024-portal-hr-source/tasks.md)、[Contracts](../../../specs/024-portal-hr-source/contracts/portal-source.md)。

**Scope:** T026–T028；US3 情境 10；FR-009、FR-012（runbook）。

## Acceptance Criteria

- [ ] CLI 只接受上述兩種指令，結束碼照合約；不接受 `--input`、`--output`、`--exclude-file`、`--acquired-at` 與 rollback 指令。
- [ ] dry-run 不寫入；被略過的員編只輸出到 stdout，不寫入 log。
- [ ] 超過門檻時，不帶參數或 N 不符都以非零狀態結束且不寫入；N 相符才套用。
- [ ] 023 的 source、import、store、recovery 程式檔已刪除，不保留檔案輸入作為替代來源。
- [ ] runbook 說明每日 04:00 匯入、如何查看 log、dry-run 與確認步驟、第一次上線超過門檻的處理、Portal 故障時的處理；不含 HEX 匯出、搬檔或回復步驟，也不寫真實員編、主機或帳密。
- [ ] 相關的 lint、單元測試、build 與 e2e 通過，並附上實際結果與未驗證的限制；整合到 `feat/024-portal-hr-source` 並追加 commit 紀錄後，才可以改成 resolved。

## Comments & Implementation Results

2026-11-03：只建立 ticket，尚未實作。ready-for-agent 不代表可以忽略 Blocked by；前置 ticket 都 resolved 後才能開始。實作結果追加在這裡。
