# 03: 透過窄 REPL 初始化及查詢維護入口

**What to build:** 維護者能在不啟動應用 HTTP、業務 worker 或外部人事服務的維運環境，明確建立唯一入口、查詢目前位置及診斷設定是否生效。

**Status:** ready-for-agent

**Blocked by:** [02-actor-aware-sessions](02-actor-aware-sessions.md)

**Source:** [Spec](../../../specs/027-super-user-access/spec.md)、[Plan](../../../specs/027-super-user-access/plan.md)、[Tasks](../../../specs/027-super-user-access/tasks.md)、[資料模型](../../../specs/027-super-user-access/data-model.md)、[API 行為](../../../specs/027-super-user-access/contracts/api-behavior.md)、[維運契約](../../../specs/027-super-user-access/contracts/operations.md)、[驗收指南](../../../specs/027-super-user-access/quickstart.md)。

**Scope:** T015、T016。

## Acceptance Criteria

- [ ] 真正 REPL 可呼叫 initialize、currentEntry、credentialStatus；啟動不自動初始化，查詢不寫入，未初始化回明確結果。
- [ ] 首次初始化以 singleton PK 仲裁，產生 32 random bytes 的 43 字元 base64url 入口與兩個初始 generation；記錄最近週一台北 04:00 的已到期週期及同交易安全事件。
- [ ] 重複初始化不覆寫入口或憑證版本；有並發時只有一組有效初始狀態。週期 helper 的邊界行為有測試，後續排程直接沿用。
- [ ] 只有明確 currentEntry 呼叫回傳目前路徑與時程；credentialStatus 不回帳號、hash 或 fingerprint。
- [ ] 窄 context 不啟動 HTTP、queue consumer、Portal、mail、storage 或自動同步，不暴露裸 SQL／repository helpers，不保留 REPL history；結束關閉 DB 連線。
- [ ] 開發與建置後 REPL 指令可用，實際展示「初始化 → 查入口／狀態 → 結束」；完整副作用與並發回歸在 027-06 再驗。

## Comments & Implementation Results

（尚未開始）
