# 04: 每日匯入核心：從 Portal 更新本機員工主檔

**What to build:** 一個可以重複執行的匯入服務，直接讀 Portal 更新本機 `users`：
- 沿用 023 的欄位規則；不合法或衝突的員編個別略過。
- 停用 Portal 明確標為非在職的人；Portal 查不到的不動，也不自動恢復。
- 單次停用超過 500 人時，整批不寫入。
- 在單一交易中鎖定後寫入，不留任何檔案。

**Status:** ready-for-agent

**Blocked by:** [01-portal-connection](01-portal-connection.md)

**Size:** L

**Source:** [Spec](../../../specs/024-portal-hr-source/spec.md)、[Plan](../../../specs/024-portal-hr-source/plan.md)、[Tasks](../../../specs/024-portal-hr-source/tasks.md)、[Contracts](../../../specs/024-portal-hr-source/contracts/portal-source.md)。

**Scope:** T020–T023；US3 情境 1–9、11、12；FR-008、FR-013；SC-005、SC-008、SC-009、SC-010。

## Acceptance Criteria

- [ ] 5,001 位合成人員（含 4-byte 中文與前導零員編）的分類與寫入正確；同來源第二次執行實際變更 0 筆，`updated_at` 不變。
- [ ] 缺姓名、Email 格式錯、欄位超長、員編不合法或同員編衝突的資料列，只略過該員編，其餘照常匯入；摘要依原因計數，log 中不出現這些員編。
- [ ] Portal 有這個員編但沒有 0／1 資料列 → 停用；查無 → 不動；已停用或軟刪除 → 不恢復；剛好 500 人可以套用，501 人整批不寫入。
- [ ] Portal 故障時本機變更 0 筆；寫入途中失敗不留部分結果；匯入交易進行中，同時有登入寫入同一員工時，登入等待匯入完成，沒有互相覆蓋。
- [ ] 不改既有 ID、部門外鍵、登入紀錄與已發起文件的快照；執行前後工作目錄沒有新增檔案；哨兵欄位的值不出現在本機資料或 log 中。
- [ ] 舊的 recovery e2e 已刪除，import e2e 只保留 repository 部分，e2e 允許清單同步更新。
- [ ] 相關的 lint、單元測試、build 與 e2e 通過，並附上實際結果與未驗證的限制；整合到 `feat/024-portal-hr-source` 並追加 commit 紀錄後，才可以改成 resolved。

## Comments & Implementation Results

2026-11-03：只建立 ticket，尚未實作。ready-for-agent 不代表可以忽略 Blocked by；前置 ticket 都 resolved 後才能開始。實作結果追加在這裡。
