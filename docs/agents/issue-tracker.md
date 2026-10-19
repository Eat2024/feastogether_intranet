# 任務追蹤：本機 Markdown

本專案使用本機 tickets，不建立 GitHub Issues。功能規格沿用 `specs/<feature>/spec.md`，不複製到另一個位置。

- 每張 ticket 獨立存於 `.scratch/<feature>/issues/<NN>-<slug>.md`，依依賴順序編號。
- `Blocked by` 指向前置 ticket；前置皆為 `resolved` 才可實作。
- 初始狀態為 `ready-for-agent`，開始實作改 `claimed`；通過驗收且合併至整合分支後改 `resolved`，追加驗證及 commit 紀錄。
- 評論與實作結果追加在 ticket 下方，保留原驗收條件。
- 實作使用單一功能整合分支，各 ticket 可獨立分支／commit 審查。只有使用者要求時才建立遠端 PR；不以建立本機 ticket 推定同意發布。
- 本機狀態名稱見 `triage-labels.md`。
