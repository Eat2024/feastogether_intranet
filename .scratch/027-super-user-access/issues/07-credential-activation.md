# 07: 明確啟用新帳密並跨實例撤銷舊維護會話

**What to build:** 維護者準備新設定後，以 REPL 明確啟用該版本；提交生效後所有舊維護會話失效，舊配置實例不能恢復舊憑證，而員工會話繼續運作。

**Status:** ready-for-agent

**Blocked by:** [04-hidden-login](04-hidden-login.md)

**Source:** [Spec](../../../specs/027-super-user-access/spec.md)、[Plan](../../../specs/027-super-user-access/plan.md)、[Tasks](../../../specs/027-super-user-access/tasks.md)、[資料模型](../../../specs/027-super-user-access/data-model.md)、[API 行為](../../../specs/027-super-user-access/contracts/api-behavior.md)、[維運契約](../../../specs/027-super-user-access/contracts/operations.md)、[驗收指南](../../../specs/027-super-user-access/quickstart.md)。

**Scope:** T045、T046、T047、T048、T049。

## Acceptance Criteria

- [ ] activateCredentials 僅讀本機已驗格式的設定，要求 expectedGeneration CAS；不接受任意帳密參數，不在啟動時自動覆寫 DB 版本。
- [ ] 新 fingerprint 增加 generation、更新生效時間、撤銷全部 active 維護會話及寫事件同交易；錯 expectedGeneration 拒絕，相同 fingerprint no-op，故障整筆 rollback。
- [ ] 每次登入及驗會話沿用本機／DB active／session 三方版本檢查，不另加快取；再啟用舊設定也必須增加 generation，舊會話不復活。
- [ ] 使用兩個共享 DB／Redis、載不同設定的真實測試實例，證明未啟用新設定登入 503，啟用後舊會話兩側拒絕、舊實例不能新登入，新設定可登入。
- [ ] 原員工會話在兩側仍有效；相同設定單純重啟不撤維護會話。測試不得以單一程序改 env 代替雙實例。
- [ ] 記錄 commit 生效點、混跑期間維護 503 與全實例更新的完成條件，不宣稱零中斷或只更新部分實例便完成。

## Comments & Implementation Results

（尚未開始）
